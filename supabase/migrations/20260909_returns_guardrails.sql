-- Dock rejections are supplier discrepancies, never warehouse inventory.
alter table public.purchase_order_items add column if not exists ordered_qty integer not null default 0;
alter table public.purchase_order_items add column if not exists processed_qty integer not null default 0;
alter table public.purchase_order_items add column if not exists remaining_qty integer not null default 0 check (remaining_qty >= 0);
alter table public.purchase_order_items add column if not exists rejected_qty integer not null default 0 check (rejected_qty >= 0);
create table if not exists public.purchase_receipt_rejections (
  id uuid primary key default gen_random_uuid(), purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete cascade,
  rejected_qty integer not null check (rejected_qty > 0), rejection_reason varchar(250) not null default 'DAMAGED_AT_RECEIVING',
  rejected_serials jsonb not null default '[]'::jsonb, rejected_by uuid references auth.users(id) on delete set null, rejected_at timestamptz not null default now()
);
create index if not exists idx_receipt_rejections_po on public.purchase_receipt_rejections(purchase_order_id, rejected_at desc);
alter table public.purchase_receipt_rejections enable row level security;
drop policy if exists receipt_rejections_read on public.purchase_receipt_rejections;
create policy receipt_rejections_read on public.purchase_receipt_rejections for select using (exists(select 1 from public.purchase_orders po where po.id=purchase_order_id and public.is_org_member(po.org_id)));

-- A dock rejection is a terminal resolution for the rejected units.  It must
-- be removed from the PO's remaining quantity, but it is deliberately not a
-- received/processed inventory quantity.
update public.purchase_order_items
set remaining_qty = greatest(0, quantity_expected - quantity_received - rejected_qty)
where coalesce(remaining_qty, -1) <> greatest(0, quantity_expected - quantity_received - rejected_qty);

create or replace function public.sync_po_quantity_tracking()
returns trigger language plpgsql set search_path=public as $$
begin
  new.ordered_qty := new.quantity_expected;
  new.processed_qty := new.quantity_received;
  new.remaining_qty := greatest(0, new.quantity_expected - new.quantity_received - coalesce(new.rejected_qty, 0));
  return new;
end;
$$;
drop trigger if exists po_quantity_tracking on public.purchase_order_items;
create trigger po_quantity_tracking
before insert or update of quantity_expected, quantity_received, rejected_qty on public.purchase_order_items
for each row execute function public.sync_po_quantity_tracking();

-- Each warehouse gets one explicit quarantine destination unless the
-- administrator has already created one. The RMA UI only offers bins in this
-- zone for damaged returns, so they can never be accidentally restocked.
insert into public.warehouse_zones (warehouse_id, zone_code, zone_type, description)
select w.id, 'QUARANTINE', 'QUARANTINE', 'System quarantine area for damaged customer returns'
from public.warehouses w
where not exists (
  select 1 from public.warehouse_zones z
  where z.warehouse_id = w.id and z.zone_type = 'QUARANTINE'
);

insert into public.locations (zone_id, location_code, aisle, rack, shelf, bin, is_active)
select z.id, 'QUAR-01', null, null, null, 'QUAR-01', true
from public.warehouse_zones z
where z.zone_type = 'QUARANTINE'
  and not exists (
    select 1 from public.locations l where l.zone_id = z.id and l.is_active
  );

-- The original exception schema allowed QUARANTINE/REPAIR only.  Good RMA
-- units now use PUTAWAY, which is the only state allowed to increase stock.
alter table public.rma_items drop constraint if exists rma_items_disposition_check;
alter table public.rma_items add constraint rma_items_disposition_check
  check (disposition in ('PUTAWAY', 'QUARANTINE', 'REPAIR'));

create or replace function public.receive_purchase_order_partial(p_purchase_order_id uuid, p_receipts jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_po public.purchase_orders%rowtype; v_entry record; v_item public.purchase_order_items%rowtype; v_serialized boolean; v_allowed integer; v_status text;
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
  end loop;
  select case when bool_and(quantity_received + rejected_qty >= quantity_expected) then 'RECEIVED' else 'PARTIALLY_RECEIVED' end
    into v_status
    from public.purchase_order_items
    where purchase_order_id=v_po.id;
  update public.purchase_orders set status=v_status where id=v_po.id;
end; $$;

create or replace function public.create_return_to_vendor(p_org_id uuid,p_supplier_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line record;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if nullif(btrim(p_supplier_name),'') is null then raise exception 'supplier name is required'; end if;
  select coalesce(max(nullif(regexp_replace(rtv_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.return_to_vendor where org_id=p_org_id;
  insert into public.return_to_vendor(id,org_id,rtv_number,supplier_name,created_by,updated_by) values(v_id,p_org_id,'RTV'||v_number,btrim(p_supplier_name),auth.uid(),auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid,location_id uuid,quantity integer,reason text) loop
    if v_line.quantity is null or v_line.quantity<=0 or nullif(btrim(v_line.reason),'') is null then raise exception 'invalid RTV line'; end if;
    if not exists(
      select 1
      from public.inventory_balances b
      join public.locations l on l.id=b.location_id
      join public.warehouse_zones z on z.id=l.zone_id
      join public.purchase_order_items poi on poi.product_id=b.product_id and poi.location_id=b.location_id
      join public.purchase_orders po on po.id=poi.purchase_order_id
      where b.product_id=v_line.product_id
        and b.location_id=v_line.location_id
        and z.zone_type='STORAGE'
        and b.quantity_on_hand-b.quantity_reserved >= v_line.quantity
        and poi.quantity_received>0
        and po.org_id=p_org_id
        and po.status in ('RECEIVED','PARTIALLY_RECEIVED','COMPLETED')
    ) then raise exception 'RTV requires accepted PO stock currently in a putaway bin'; end if;
    insert into public.return_to_vendor_items(rtv_id,product_id,location_id,quantity,reason) values(v_id,v_line.product_id,v_line.location_id,v_line.quantity,btrim(v_line.reason));
  end loop; return v_id;
end; $$;

create or replace function public.dispatch_return_to_vendor(p_rtv_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_rtv public.return_to_vendor%rowtype; v_item record;
begin
  select * into v_rtv from public.return_to_vendor where id=p_rtv_id for update; if v_rtv.id is null then raise exception 'RTV not found'; end if;
  if not public.is_org_role(v_rtv.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_rtv.status<>'PENDING' then raise exception 'only pending RTV records can be dispatched'; end if;
  for v_item in select * from public.return_to_vendor_items where rtv_id=v_rtv.id loop
    update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_item.quantity,updated_at=now() where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='' and quantity_on_hand-quantity_reserved>=v_item.quantity;
    if not found then raise exception 'insufficient accepted putaway stock for RTV dispatch'; end if;
  end loop; update public.return_to_vendor set status='SHIPPED',updated_by=auth.uid() where id=v_rtv.id;
end; $$;

create or replace function public.create_rma_and_receive(p_org_id uuid,p_sales_order_id uuid,p_customer_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=gen_random_uuid(); v_number text; v_line record; v_zone_type text; v_shipped_qty integer; v_already_returned integer;
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
    if v_line.quantity + v_already_returned > v_shipped_qty then raise exception 'RMA quantity exceeds the shipped quantity for this sales order'; end if;
    select z.zone_type into v_zone_type from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_line.location_id;
    if v_line.disposition='QUARANTINE' and coalesce(v_zone_type,'')<>'QUARANTINE' then raise exception 'select a bin in a QUARANTINE zone for damaged returns'; end if;
    if v_line.disposition='PUTAWAY' and coalesce(v_zone_type,'')<>'STORAGE' then raise exception 'select a STORAGE bin for restockable returns'; end if;
    insert into public.rma_items(rma_id,product_id,location_id,quantity_received,disposition,reason) values(v_id,v_line.product_id,v_line.location_id,v_line.quantity,v_line.disposition,v_line.reason);
    if v_line.disposition='PUTAWAY' then insert into public.inventory_balances(product_id,location_id,lot_number,quantity_on_hand) values(v_line.product_id,v_line.location_id,'',v_line.quantity) on conflict(product_id,location_id,lot_number) do update set quantity_on_hand=public.inventory_balances.quantity_on_hand+excluded.quantity_on_hand,updated_at=now(); else insert into public.inventory_balances(product_id,location_id,lot_number,quantity_quarantined) values(v_line.product_id,v_line.location_id,'',v_line.quantity) on conflict(product_id,location_id,lot_number) do update set quantity_quarantined=public.inventory_balances.quantity_quarantined+excluded.quantity_quarantined,updated_at=now(); end if;
  end loop; return v_id;
end; $$;
