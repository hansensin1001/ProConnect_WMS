-- End-to-end traceability: link every vendor return to the exact inbound PO,
-- write stock-changing returns to the inventory ledger, and expose one
-- organization-scoped report feed for PO/SO/returns/cycle-count audits.
create extension if not exists pgcrypto;

alter table public.return_to_vendor_items
  add column if not exists purchase_order_id uuid references public.purchase_orders(id) on delete restrict;
create index if not exists idx_rtv_items_purchase_order on public.return_to_vendor_items(purchase_order_id);
create index if not exists idx_rma_items_location on public.rma_items(location_id, product_id);
create index if not exists idx_cycle_count_items_location on public.cycle_count_items(location_id, product_id);

create or replace function public.receive_purchase_order_partial(p_purchase_order_id uuid, p_receipts jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_po public.purchase_orders%rowtype; v_entry record; v_item public.purchase_order_items%rowtype; v_serialized boolean; v_allowed integer; v_status text; v_warehouse_id uuid;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status not in ('PENDING','PARTIALLY_RECEIVED') then raise exception 'only pending purchase orders can be received'; end if;
  for v_entry in select * from jsonb_to_recordset(p_receipts) as x(purchase_order_item_id uuid,quantity integer,disposition text,rejected_serials jsonb) loop
    if v_entry.quantity is null or v_entry.quantity<=0 or coalesce(v_entry.disposition,'') not in ('AVAILABLE','REJECTED') then raise exception 'invalid receipt line'; end if;
    select * into v_item from public.purchase_order_items where id=v_entry.purchase_order_item_id and purchase_order_id=v_po.id for update;
    if v_item.id is null then raise exception 'receipt line is not part of this purchase order'; end if;
    v_allowed:=v_item.quantity_expected-v_item.quantity_received-v_item.rejected_qty;
    if v_entry.quantity>v_allowed then raise exception 'receipt or rejection quantity exceeds the unprocessed purchase order balance'; end if;
    select is_serialized into v_serialized from public.products where id=v_item.product_id;
    if v_entry.disposition='REJECTED' then
      if v_serialized and jsonb_array_length(coalesce(v_entry.rejected_serials,'[]'::jsonb))<>v_entry.quantity then raise exception 'rejected serialised stock requires one rejected serial per unit'; end if;
      insert into public.purchase_receipt_rejections(purchase_order_id,purchase_order_item_id,rejected_qty,rejected_serials,rejected_by) values(v_po.id,v_item.id,v_entry.quantity,coalesce(v_entry.rejected_serials,'[]'::jsonb),auth.uid());
      update public.purchase_order_items set rejected_qty=rejected_qty+v_entry.quantity where id=v_item.id;
      continue;
    end if;
    if v_serialized then raise exception 'serialised accepted receipts must use the serial receiving workflow'; end if;
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

-- A new RTV must preserve its source PO. Existing RTV data is intentionally
-- left nullable: guessing a historic source PO would produce false audit data.
create or replace function public.create_return_to_vendor(p_org_id uuid,p_supplier_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line record;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if nullif(btrim(p_supplier_name),'') is null then raise exception 'supplier name is required'; end if;
  select coalesce(max(nullif(regexp_replace(rtv_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.return_to_vendor where org_id=p_org_id;
  insert into public.return_to_vendor(id,org_id,rtv_number,supplier_name,created_by,updated_by) values(v_id,p_org_id,'RTV'||v_number,btrim(p_supplier_name),auth.uid(),auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(purchase_order_id uuid,product_id uuid,location_id uuid,quantity integer,reason text) loop
    if v_line.purchase_order_id is null or v_line.quantity is null or v_line.quantity<=0 or nullif(btrim(v_line.reason),'') is null then raise exception 'invalid RTV line'; end if;
    if not exists(
      select 1 from public.inventory_balances b
      join public.locations l on l.id=b.location_id
      join public.warehouse_zones z on z.id=l.zone_id
      join public.purchase_order_items poi on poi.purchase_order_id=v_line.purchase_order_id and poi.product_id=b.product_id and poi.location_id=b.location_id
      join public.purchase_orders po on po.id=poi.purchase_order_id
      where b.product_id=v_line.product_id and b.location_id=v_line.location_id
        and z.zone_type='STORAGE' and b.quantity_on_hand-b.quantity_reserved>=v_line.quantity
        and poi.quantity_received>0 and po.org_id=p_org_id and po.status in ('RECEIVED','PARTIALLY_RECEIVED','COMPLETED')
    ) then raise exception 'RTV requires accepted PO stock currently in a putaway bin'; end if;
    insert into public.return_to_vendor_items(rtv_id,purchase_order_id,product_id,location_id,quantity,reason)
      values(v_id,v_line.purchase_order_id,v_line.product_id,v_line.location_id,v_line.quantity,btrim(v_line.reason));
  end loop;
  return v_id;
end; $$;

create or replace function public.dispatch_return_to_vendor(p_rtv_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_rtv public.return_to_vendor%rowtype; v_item record; v_warehouse_id uuid;
begin
  select * into v_rtv from public.return_to_vendor where id=p_rtv_id for update;
  if v_rtv.id is null then raise exception 'RTV not found'; end if;
  if not public.is_org_role(v_rtv.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_rtv.status<>'PENDING' then raise exception 'only pending RTV records can be dispatched'; end if;
  for v_item in select * from public.return_to_vendor_items where rtv_id=v_rtv.id loop
    update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_item.quantity,updated_at=now()
      where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='' and quantity_on_hand-quantity_reserved>=v_item.quantity;
    if not found then raise exception 'insufficient accepted putaway stock for RTV dispatch'; end if;
    select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_item.location_id;
    insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id)
      values(v_rtv.org_id,v_warehouse_id,v_item.product_id,v_item.location_id,'OUTBOUND',-v_item.quantity,'RETURN_TO_VENDOR',v_rtv.id,v_item.reason,auth.uid());
  end loop;
  update public.return_to_vendor set status='SHIPPED',updated_by=auth.uid() where id=v_rtv.id;
end; $$;

create or replace function public.create_rma_and_receive(p_org_id uuid,p_sales_order_id uuid,p_customer_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line record; v_zone_type text; v_shipped_qty integer; v_already_returned integer; v_warehouse_id uuid;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if p_sales_order_id is null or not exists(select 1 from public.sales_orders where id=p_sales_order_id and org_id=p_org_id and status='SHIPPED') then raise exception 'RMA requires a verified shipped sales order'; end if;
  select coalesce(max(nullif(regexp_replace(rma_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.rmas where org_id=p_org_id;
  insert into public.rmas(id,org_id,rma_number,sales_order_id,customer_name,status,created_by,updated_by) values(v_id,p_org_id,'RMA'||v_number,p_sales_order_id,nullif(p_customer_name,''),'RECEIVED',auth.uid(),auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid,location_id uuid,quantity integer,disposition text,reason text) loop
    if v_line.quantity is null or v_line.quantity<=0 or v_line.disposition not in ('PUTAWAY','QUARANTINE') or nullif(btrim(v_line.reason),'') is null then raise exception 'invalid RMA line'; end if;
    if not exists(select 1 from public.order_items where sales_order_id=p_sales_order_id and product_id=v_line.product_id) then raise exception 'RMA SKU was not shipped on the selected sales order'; end if;
    select coalesce(sum(quantity_requested),0) into v_shipped_qty from public.order_items where sales_order_id=p_sales_order_id and product_id=v_line.product_id;
    select coalesce(sum(ri.quantity_received),0) into v_already_returned from public.rma_items ri join public.rmas r on r.id=ri.rma_id where r.sales_order_id=p_sales_order_id and ri.product_id=v_line.product_id and r.status<>'CANCELLED';
    if v_line.quantity+v_already_returned>v_shipped_qty then raise exception 'RMA quantity exceeds the shipped quantity for this sales order'; end if;
    select z.zone_type,z.warehouse_id into v_zone_type,v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_line.location_id;
    if v_line.disposition='QUARANTINE' and coalesce(v_zone_type,'')<>'QUARANTINE' then raise exception 'select a bin in a QUARANTINE zone for damaged returns'; end if;
    if v_line.disposition='PUTAWAY' and coalesce(v_zone_type,'')<>'STORAGE' then raise exception 'select a STORAGE bin for restockable returns'; end if;
    insert into public.rma_items(rma_id,product_id,location_id,quantity_received,disposition,reason) values(v_id,v_line.product_id,v_line.location_id,v_line.quantity,v_line.disposition,btrim(v_line.reason));
    if v_line.disposition='PUTAWAY' then
      insert into public.inventory_balances(product_id,location_id,lot_number,quantity_on_hand) values(v_line.product_id,v_line.location_id,'',v_line.quantity)
        on conflict(product_id,location_id,lot_number) do update set quantity_on_hand=public.inventory_balances.quantity_on_hand+excluded.quantity_on_hand,updated_at=now();
      insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id)
        values(p_org_id,v_warehouse_id,v_line.product_id,v_line.location_id,'INBOUND',v_line.quantity,'CUSTOMER_RETURN',v_id,btrim(v_line.reason),auth.uid());
    else
      insert into public.inventory_balances(product_id,location_id,lot_number,quantity_quarantined) values(v_line.product_id,v_line.location_id,'',v_line.quantity)
        on conflict(product_id,location_id,lot_number) do update set quantity_quarantined=public.inventory_balances.quantity_quarantined+excluded.quantity_quarantined,updated_at=now();
    end if;
  end loop;
  return v_id;
end; $$;

create or replace function public.get_traceability_report(
  p_org_id uuid, p_from timestamptz default null, p_to timestamptz default null,
  p_warehouse_id uuid default null, p_zone_id uuid default null, p_location_id uuid default null,
  p_search text default null, p_event_type text default null, p_limit integer default 100, p_offset integer default 0
) returns table(
  event_id uuid,event_type text,occurred_at timestamptz,status text,quantity_delta integer,item_condition text,reason text,
  sku text,product_name text,purchase_order_number text,sales_order_number text,rma_number text,rtv_number text,
  supplier_name text,customer_name text,warehouse_id uuid,zone_id uuid,location_id uuid,bin_path text
) language sql stable security invoker set search_path=public as $$
  with events as (
    -- Explicit aliases define the CTE contract.  Without these, PostgreSQL
    -- inherits names such as "created_at" from the first SELECT and later
    -- references to e.occurred_at fail.
    select
      t.id as event_id,
      'INVENTORY'::text as event_type,
      t.created_at as occurred_at,
      coalesce(t.transaction_type,'')::text as status,
      t.quantity_delta as quantity_delta,
      ''::text as item_condition,
      coalesce(t.reason,'')::text as reason,
      p.sku as sku,
      p.name as product_name,
      po.po_number as purchase_order_number,
      so.order_number as sales_order_number,
      null::text as rma_number,
      null::text as rtv_number,
      po.supplier_name as supplier_name,
      so.customer_name as customer_name,
      t.warehouse_id as warehouse_id,
      z.id as zone_id,
      t.location_id as location_id,
      concat_ws(' / ',w.name,z.zone_code,coalesce(l.display_code,l.location_code)) as bin_path
    from public.inventory_transactions t join public.products p on p.id=t.product_id
    left join public.purchase_orders po on t.reference_type='PURCHASE_ORDER' and po.id=t.reference_id
    left join public.sales_orders so on t.reference_type='SALES_ORDER' and so.id=t.reference_id
    left join public.locations l on l.id=t.location_id left join public.warehouse_zones z on z.id=l.zone_id left join public.warehouses w on w.id=z.warehouse_id
    where t.org_id=p_org_id
    union all
    select pr.id,'PO_REJECTED'::text,pr.rejected_at,'REJECTED_AT_RECEIVING'::text,0,'DOCK_REJECTED'::text,pr.rejection_reason,
      p.sku,p.name,po.po_number,null::text,null::text,null::text,po.supplier_name,null::text,
      null::uuid,null::uuid,null::uuid,'[Dock — not put away]'::text
    from public.purchase_receipt_rejections pr join public.purchase_orders po on po.id=pr.purchase_order_id join public.purchase_order_items poi on poi.id=pr.purchase_order_item_id join public.products p on p.id=poi.product_id
    where po.org_id=p_org_id
    union all
    select ri.id,'RMA'::text,r.created_at,r.status,case when ri.disposition='PUTAWAY' then ri.quantity_received else 0 end,ri.disposition,ri.reason,
      p.sku,p.name,null::text,so.order_number,r.rma_number,null::text,null::text,coalesce(r.customer_name,so.customer_name),
      w.id,z.id,l.id,concat_ws(' / ',w.name,z.zone_code,coalesce(l.display_code,l.location_code))
    from public.rma_items ri join public.rmas r on r.id=ri.rma_id join public.products p on p.id=ri.product_id left join public.sales_orders so on so.id=r.sales_order_id join public.locations l on l.id=ri.location_id join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id
    where r.org_id=p_org_id
    union all
    select ri.id,'RTV'::text,case when r.status='SHIPPED' then r.updated_at else r.created_at end,r.status,case when r.status='SHIPPED' then -ri.quantity else 0 end,'RETURN_TO_VENDOR'::text,ri.reason,
      p.sku,p.name,po.po_number,null::text,null::text,r.rtv_number,r.supplier_name,null::text,
      w.id,z.id,l.id,concat_ws(' / ',w.name,z.zone_code,coalesce(l.display_code,l.location_code))
    from public.return_to_vendor_items ri join public.return_to_vendor r on r.id=ri.rtv_id join public.products p on p.id=ri.product_id left join public.purchase_orders po on po.id=ri.purchase_order_id join public.locations l on l.id=ri.location_id join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id
    where r.org_id=p_org_id
    union all
    select ci.id,'CYCLE_COUNT'::text,coalesce(c.approved_at,c.counted_at),c.status,ci.physical_quantity-ci.system_quantity,'COUNT'::text,coalesce(ci.reason_code,''),
      p.sku,p.name,null::text,null::text,null::text,null::text,null::text,null::text,
      w.id,z.id,l.id,concat_ws(' / ',w.name,z.zone_code,coalesce(l.display_code,l.location_code))
    from public.cycle_count_items ci join public.cycle_counts c on c.id=ci.cycle_count_id join public.products p on p.id=ci.product_id join public.locations l on l.id=ci.location_id join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id
    where c.org_id=p_org_id
  )
  select
    e.event_id,
    e.event_type,
    e.occurred_at,
    e.status,
    e.quantity_delta,
    e.item_condition,
    e.reason,
    e.sku,
    e.product_name,
    e.purchase_order_number,
    e.sales_order_number,
    e.rma_number,
    e.rtv_number,
    e.supplier_name,
    e.customer_name,
    e.warehouse_id,
    e.zone_id,
    e.location_id,
    e.bin_path
  from events e
  where public.is_org_member(p_org_id)
    and (p_from is null or e.occurred_at>=p_from) and (p_to is null or e.occurred_at<p_to)
    and (p_warehouse_id is null or e.warehouse_id=p_warehouse_id) and (p_zone_id is null or e.zone_id=p_zone_id) and (p_location_id is null or e.location_id=p_location_id)
    and (p_event_type is null or p_event_type='ALL' or e.event_type=p_event_type)
    and (p_search is null or btrim(p_search)='' or concat_ws(' ',e.sku,e.product_name,e.purchase_order_number,e.sales_order_number,e.rma_number,e.rtv_number,e.supplier_name,e.customer_name,e.bin_path) ilike '%'||btrim(p_search)||'%')
  order by e.occurred_at desc,e.event_id desc
  limit greatest(1,least(coalesce(p_limit,100),200)) offset greatest(0,coalesce(p_offset,0));
$$;

create index if not exists idx_purchase_receipt_rejections_item on public.purchase_receipt_rejections(purchase_order_item_id,rejected_at desc);
