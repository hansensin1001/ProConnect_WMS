-- Apply after the existing serial-return and exception migrations.
-- No rows are deleted or renumbered. Function signatures stay unchanged.
-- Exceptions abort the full transaction; no partial stock changes survive.
begin;

create or replace function public.receive_purchase_order_partial(p_purchase_order_id uuid, p_receipts jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_po public.purchase_orders%rowtype; v_entry record; v_item public.purchase_order_items%rowtype; v_serialized boolean; v_allowed integer; v_status text; v_warehouse_id uuid;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status not in ('PENDING','PARTIALLY_RECEIVED') then raise exception 'only pending purchase orders can be received'; end if;
  if jsonb_typeof(p_receipts) is distinct from 'array' then raise exception 'invalid receipt lines'; end if;
  if jsonb_array_length(p_receipts)=0 or jsonb_array_length(p_receipts)>100 then raise exception 'invalid receipt lines'; end if;
  for v_entry in select * from jsonb_to_recordset(p_receipts) as x(purchase_order_item_id uuid,quantity integer,disposition text,rejected_serials jsonb) loop
    if v_entry.quantity is null or v_entry.quantity<=0 or coalesce(v_entry.disposition,'') not in ('AVAILABLE','REJECTED') then raise exception 'invalid receipt line'; end if;
    select * into v_item from public.purchase_order_items where id=v_entry.purchase_order_item_id and purchase_order_id=v_po.id for update;
    if v_item.id is null then raise exception 'receipt line is not part of this purchase order'; end if;
    v_allowed:=v_item.quantity_expected-v_item.quantity_received-v_item.rejected_qty;
    if v_entry.quantity>v_allowed then raise exception 'receipt or rejection quantity exceeds the unprocessed purchase order balance'; end if;
    select is_serialized into v_serialized from public.products where id=v_item.product_id;
    if v_entry.disposition='REJECTED' then
      if jsonb_typeof(coalesce(v_entry.rejected_serials,'[]'::jsonb)) <> 'array' then raise exception 'invalid rejected serial list'; end if;
      if (select count(*)<>count(distinct upper(btrim(value))) from jsonb_array_elements_text(coalesce(v_entry.rejected_serials,'[]'::jsonb))) then raise exception 'duplicate rejected serial numbers'; end if;
      if v_serialized and jsonb_array_length(coalesce(v_entry.rejected_serials,'[]'::jsonb))<>v_entry.quantity then raise exception 'rejected serialised stock requires one rejected serial per unit'; end if;
      insert into public.purchase_receipt_rejections(purchase_order_id,purchase_order_item_id,rejected_qty,rejected_serials,rejected_by) values(v_po.id,v_item.id,v_entry.quantity,coalesce(v_entry.rejected_serials,'[]'::jsonb),auth.uid());
      update public.purchase_order_items set rejected_qty=rejected_qty+v_entry.quantity where id=v_item.id;
      continue;
    end if;
    if v_serialized then raise exception 'serialised accepted receipts must use the serial receiving workflow'; end if;
    if not exists(select 1 from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where l.id=v_item.location_id and l.is_active and z.zone_type='STORAGE' and w.org_id=v_po.org_id) then raise exception 'select an active storage bin on this PO before accepting goods'; end if;
    insert into public.inventory_balances(product_id,location_id,lot_number,quantity_on_hand) values(v_item.product_id,v_item.location_id,'',v_entry.quantity)
      on conflict(product_id,location_id,lot_number) do update set quantity_on_hand=public.inventory_balances.quantity_on_hand+excluded.quantity_on_hand,updated_at=now();
    update public.purchase_order_items set quantity_received=quantity_received+v_entry.quantity where id=v_item.id;
    select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_item.location_id;
    insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id)
      values(v_po.org_id,v_warehouse_id,v_item.product_id,v_item.location_id,'INBOUND',v_entry.quantity,'PURCHASE_ORDER',v_po.id,'Partial PO receipt',auth.uid());
  end loop;
  select case when bool_and(quantity_received+rejected_qty>=quantity_expected) then 'RECEIVED' else 'PARTIALLY_RECEIVED' end into v_status from public.purchase_order_items where purchase_order_id=v_po.id;
  update public.purchase_orders set status=v_status where id=v_po.id;
end; $$;

create or replace function public.fulfill_sales_order_partial(p_sales_order_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_order public.sales_orders%rowtype; v_line record; v_item public.order_items%rowtype; v_allocation record; v_remaining integer; v_take integer; v_warehouse_id uuid;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('ALLOCATED','PARTIALLY_SHIPPED') then raise exception 'only allocated sales orders can be partially shipped'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'invalid shipment lines'; end if;
  if jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception 'invalid shipment lines'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(order_item_id uuid,quantity integer) loop
    if v_line.quantity is null or v_line.quantity<=0 then raise exception 'invalid shipment quantity'; end if;
    select * into v_item from public.order_items where id=v_line.order_item_id and sales_order_id=v_order.id for update;
    if v_item.id is null then raise exception 'shipment line is not part of this sales order'; end if;
    if exists(select 1 from public.products where id=v_item.product_id and is_serialized) then raise exception 'serialised items must be fulfilled through the serial scanning workflow'; end if;
    if v_line.quantity > v_item.quantity_reserved-v_item.quantity_picked then raise exception 'shipment quantity exceeds the allocated balance'; end if;
    v_remaining:=v_line.quantity;
    for v_allocation in select a.*,b.product_id,b.location_id from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id where a.order_item_id=v_item.id and a.quantity_fulfilled<a.quantity_reserved order by a.inventory_balance_id,a.id for update of a,b loop
      v_take:=least(v_remaining,v_allocation.quantity_reserved-v_allocation.quantity_fulfilled); if v_take<=0 then continue; end if;
      update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_take,quantity_reserved=quantity_reserved-v_take,updated_at=now() where id=v_allocation.inventory_balance_id and quantity_on_hand>=v_take and quantity_reserved>=v_take;
      if not found then raise exception 'shipment blocked: source balance changed; refresh the order'; end if;
      update public.order_item_allocations set quantity_fulfilled=quantity_fulfilled+v_take where id=v_allocation.id;
      update public.order_items set quantity_picked=quantity_picked+v_take where id=v_item.id;
      select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_allocation.location_id;
      insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_order.org_id,v_warehouse_id,v_allocation.product_id,v_allocation.location_id,'OUTBOUND',-v_take,'SALES_ORDER',v_order.id,'Partial sales order fulfillment',auth.uid());
      v_remaining:=v_remaining-v_take; exit when v_remaining=0;
    end loop;
    if v_remaining<>0 then raise exception 'shipment blocked: remaining allocation cannot supply the requested quantity'; end if;
  end loop;
  update public.sales_orders set status=case when not exists(select 1 from public.order_items where sales_order_id=v_order.id and quantity_picked<quantity_requested) then 'SHIPPED' else 'PARTIALLY_SHIPPED' end where id=v_order.id;
end; $$;

create or replace function public.allocate_sales_order(p_sales_order_id uuid, p_picking_location_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_item record; v_balance record;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('NEW','DRAFT') then raise exception 'only new orders can be allocated'; end if;
  if p_picking_location_id is not null and not exists(select 1 from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where l.id=p_picking_location_id and l.is_active and z.zone_type='PICKING' and w.org_id=v_order.org_id) then raise exception 'picking location is invalid for the active organization'; end if;
  for v_item in select oi.*,p.is_serialized from public.order_items oi join public.products p on p.id=oi.product_id where oi.sales_order_id=p_sales_order_id for update of oi loop
    select b.id,b.location_id,b.quantity_on_hand,b.quantity_reserved into v_balance
    from public.inventory_balances b join public.locations l on l.id=b.location_id join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id
    where l.is_active and z.zone_type='STORAGE' and w.org_id=v_order.org_id and b.product_id=v_item.product_id and b.lot_number='' and b.quantity_on_hand-b.quantity_reserved>=v_item.quantity_requested
      and (not v_item.is_serialized or (select count(*) from public.serial_numbers sn where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id and sn.location_id=b.location_id and sn.status='IN_STOCK')>=v_item.quantity_requested)
    order by coalesce(l.display_code,l.location_code),l.id for update of b limit 1;
    if v_balance.id is null then raise exception 'insufficient available stock for product %',v_item.product_id; end if;
    update public.inventory_balances set quantity_reserved=quantity_reserved+v_item.quantity_requested,updated_at=now() where id=v_balance.id;
    insert into public.order_item_allocations(order_item_id,inventory_balance_id,quantity_reserved,picking_location_id) values(v_item.id,v_balance.id,v_item.quantity_requested,p_picking_location_id);
    update public.order_items set quantity_reserved=quantity_requested where id=v_item.id;
  end loop;
  update public.sales_orders set status='ALLOCATED' where id=p_sales_order_id;
end;
$$;

create or replace function public.submit_cycle_count(p_org_id uuid,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line record; v_system integer;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if jsonb_typeof(p_lines) is distinct from 'array' then raise exception 'invalid cycle-count lines'; end if;
  if jsonb_array_length(p_lines)=0 or jsonb_array_length(p_lines)>100 then raise exception 'invalid cycle-count lines'; end if;
  select coalesce(max(nullif(regexp_replace(count_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.cycle_counts where org_id=p_org_id;
  insert into public.cycle_counts(id,org_id,count_number,counted_by) values(v_id,p_org_id,'CC'||v_number,auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid,location_id uuid,physical_quantity integer,reason_code text) loop
    if not exists(select 1 from public.products p,public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where p.id=v_line.product_id and p.org_id=p_org_id and l.id=v_line.location_id and l.is_active and z.zone_type='STORAGE' and w.org_id=p_org_id) then raise exception 'cycle count requires a product and active storage bin in this organization'; end if;
    select coalesce(sum(b.quantity_on_hand),0) into v_system from public.inventory_balances b join public.products p on p.id=b.product_id where b.product_id=v_line.product_id and b.location_id=v_line.location_id and p.org_id=p_org_id;
    if v_line.physical_quantity is null or v_line.physical_quantity<0 or (v_line.physical_quantity<>v_system and coalesce(v_line.reason_code,'') not in ('DAMAGED','MISSING','MISPLACED','COUNT_ERROR','OTHER')) then raise exception 'a reason code is required for every discrepancy'; end if;
    insert into public.cycle_count_items(cycle_count_id,product_id,location_id,system_quantity,physical_quantity,reason_code) values(v_id,v_line.product_id,v_line.location_id,v_system,v_line.physical_quantity,nullif(v_line.reason_code,''));
  end loop; return v_id;
end; $$;

create or replace function public.approve_cycle_count(p_cycle_count_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_count public.cycle_counts%rowtype; v_item record; v_delta integer; v_warehouse_id uuid; v_current integer; v_reserved integer; v_balances integer; v_quarantined integer;
begin
  select * into v_count from public.cycle_counts where id=p_cycle_count_id for update; if v_count.id is null then raise exception 'cycle count not found'; end if;
  if not public.is_org_role(v_count.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_count.status<>'PENDING_APPROVAL' then raise exception 'cycle count has already been reconciled'; end if;
  if not p_approve then update public.cycle_counts set status='REJECTED',approved_by=auth.uid(),approved_at=now() where id=v_count.id; return; end if;
  for v_item in select * from public.cycle_count_items where cycle_count_id=v_count.id order by product_id,location_id loop
    perform 1 from public.inventory_balances where product_id=v_item.product_id and location_id=v_item.location_id order by id for update;
    select coalesce(sum(quantity_on_hand),0),coalesce(sum(quantity_reserved),0),count(*),coalesce(sum(quantity_quarantined),0) into v_current,v_reserved,v_balances,v_quarantined from public.inventory_balances where product_id=v_item.product_id and location_id=v_item.location_id;
    if v_current<>v_item.system_quantity then raise exception 'cycle count stock changed after counting; reject this count and recount the bin'; end if;
    if v_item.physical_quantity<v_reserved then raise exception 'cycle count cannot remove reserved stock; resolve allocations before recounting'; end if;
    v_delta:=v_item.physical_quantity-v_item.system_quantity;
    if v_delta<>0 then
      if exists(select 1 from public.products where id=v_item.product_id and is_serialized) then raise exception 'cycle count cannot adjust serialized quantities without reconciling individual serials'; end if;
      if v_quarantined>0 then raise exception 'cycle count cannot adjust mixed quarantine stock; reconcile the stock conditions first'; end if;
      if v_balances>1 then raise exception 'cycle count spans multiple lots; reconcile the individual lots before approval'; end if;
      if v_balances=1 then update public.inventory_balances set quantity_on_hand=v_item.physical_quantity,updated_at=now() where product_id=v_item.product_id and location_id=v_item.location_id;
      else insert into public.inventory_balances(product_id,location_id,lot_number,quantity_on_hand) values(v_item.product_id,v_item.location_id,'',v_item.physical_quantity); end if;
    end if;
    if v_delta<>0 then select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_item.location_id; insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_count.org_id,v_warehouse_id,v_item.product_id,v_item.location_id,'ADJUSTMENT',v_delta,'CYCLE_COUNT',v_count.id,v_item.reason_code,auth.uid()); end if;
  end loop;
  update public.cycle_counts set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=v_count.id;
end; $$;

commit;
