-- Exception handling is ledger-first: quarantined stock is never included in
-- quantity_on_hand, and every reconciliation action retains its source record.

create extension if not exists "uuid-ossp";

alter table public.inventory_balances add column if not exists quantity_quarantined integer not null default 0 check (quantity_quarantined >= 0);

create table if not exists public.mispick_attempts (
  id uuid primary key default uuid_generate_v4(), org_id uuid not null references public.organizations(id) on delete cascade,
  sales_order_id uuid references public.sales_orders(id) on delete set null, order_item_id uuid references public.order_items(id) on delete set null,
  scanned_value varchar(160) not null, expected_product_id uuid references public.products(id) on delete set null,
  reason_code varchar(50) not null check (reason_code in ('WRONG_SKU','WRONG_SERIAL','WRONG_BIN','NOT_ALLOCATED')),
  user_id uuid references auth.users(id) on delete set null, created_at timestamptz not null default now()
);

create table if not exists public.return_to_vendor (
  id uuid primary key default uuid_generate_v4(), org_id uuid not null references public.organizations(id) on delete cascade,
  rtv_number varchar(50) not null, supplier_name varchar(100) not null, status varchar(30) not null default 'PENDING' check (status in ('PENDING','SHIPPED','CANCELLED')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(), unique(org_id, rtv_number)
);
create table if not exists public.return_to_vendor_items (
  id uuid primary key default uuid_generate_v4(), rtv_id uuid not null references public.return_to_vendor(id) on delete cascade,
  product_id uuid not null references public.products(id), location_id uuid not null references public.locations(id), quantity integer not null check (quantity > 0), reason varchar(250) not null
);

create table if not exists public.rmas (
  id uuid primary key default uuid_generate_v4(), org_id uuid not null references public.organizations(id) on delete cascade,
  rma_number varchar(50) not null, sales_order_id uuid references public.sales_orders(id) on delete set null,
  customer_name varchar(100), status varchar(30) not null default 'OPEN' check (status in ('OPEN','RECEIVED','CLOSED','CANCELLED')),
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null, updated_at timestamptz not null default now(), unique(org_id, rma_number)
);
create table if not exists public.rma_items (
  id uuid primary key default uuid_generate_v4(), rma_id uuid not null references public.rmas(id) on delete cascade,
  product_id uuid not null references public.products(id), location_id uuid not null references public.locations(id),
  quantity_received integer not null check (quantity_received > 0), disposition varchar(20) not null check (disposition in ('QUARANTINE','REPAIR')), reason varchar(250) not null
);

create table if not exists public.cycle_counts (
  id uuid primary key default uuid_generate_v4(), org_id uuid not null references public.organizations(id) on delete cascade,
  count_number varchar(50) not null, status varchar(30) not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL','APPROVED','REJECTED')),
  counted_by uuid references auth.users(id) on delete set null, counted_at timestamptz not null default now(),
  approved_by uuid references auth.users(id) on delete set null, approved_at timestamptz, created_at timestamptz not null default now(), unique(org_id, count_number)
);
create table if not exists public.cycle_count_items (
  id uuid primary key default uuid_generate_v4(), cycle_count_id uuid not null references public.cycle_counts(id) on delete cascade,
  product_id uuid not null references public.products(id), location_id uuid not null references public.locations(id),
  system_quantity integer not null, physical_quantity integer not null check (physical_quantity >= 0), reason_code varchar(40), unique(cycle_count_id, product_id, location_id),
  check ((physical_quantity = system_quantity and reason_code is null) or (physical_quantity <> system_quantity and reason_code in ('DAMAGED','MISSING','MISPLACED','COUNT_ERROR','OTHER')))
);

create index if not exists idx_mispicks_org_created on public.mispick_attempts(org_id, created_at desc);
create index if not exists idx_rtv_org_status on public.return_to_vendor(org_id, status, created_at desc);
create index if not exists idx_rma_org_status on public.rmas(org_id, status, created_at desc);
create index if not exists idx_cycle_counts_org_status on public.cycle_counts(org_id, status, created_at desc);

create or replace function public.receive_purchase_order_partial(p_purchase_order_id uuid, p_receipts jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_po public.purchase_orders%rowtype; v_entry record; v_item public.purchase_order_items%rowtype; v_is_serialized boolean; v_remaining integer; v_status text;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status not in ('PENDING','PARTIALLY_RECEIVED') then raise exception 'only pending purchase orders can be received'; end if;
  if jsonb_typeof(p_receipts) <> 'array' or jsonb_array_length(p_receipts)=0 then raise exception 'at least one receipt line is required'; end if;
  for v_entry in select * from jsonb_to_recordset(p_receipts) as x(purchase_order_item_id uuid, quantity integer, disposition text) loop
    if v_entry.quantity is null or v_entry.quantity <= 0 or coalesce(v_entry.disposition,'AVAILABLE') not in ('AVAILABLE','QUARANTINE') then raise exception 'invalid receipt line'; end if;
    select poi.* into v_item from public.purchase_order_items poi where poi.id=v_entry.purchase_order_item_id and poi.purchase_order_id=v_po.id for update;
    if v_item.id is null then raise exception 'receipt line is not part of this purchase order'; end if;
    select p.is_serialized into v_is_serialized from public.products p where p.id=v_item.product_id;
    if v_is_serialized then raise exception 'serialised receipt lines must use the serial receiving workflow'; end if;
    v_remaining := v_item.quantity_expected-v_item.quantity_received;
    if v_entry.quantity > v_remaining then raise exception 'received quantity exceeds the remaining purchase order quantity'; end if;
    if v_entry.disposition='AVAILABLE' then
      insert into public.inventory_balances(product_id,location_id,lot_number,quantity_on_hand) values(v_item.product_id,v_item.location_id,'',v_entry.quantity)
      on conflict(product_id,location_id,lot_number) do update set quantity_on_hand=public.inventory_balances.quantity_on_hand+excluded.quantity_on_hand,updated_at=now();
    else
      insert into public.inventory_balances(product_id,location_id,lot_number,quantity_quarantined) values(v_item.product_id,v_item.location_id,'',v_entry.quantity)
      on conflict(product_id,location_id,lot_number) do update set quantity_quarantined=public.inventory_balances.quantity_quarantined+excluded.quantity_quarantined,updated_at=now();
    end if;
    update public.purchase_order_items set quantity_received=quantity_received+v_entry.quantity where id=v_item.id;
  end loop;
  select case when bool_and(quantity_received>=quantity_expected) then 'RECEIVED' else 'PARTIALLY_RECEIVED' end into v_status from public.purchase_order_items where purchase_order_id=v_po.id;
  update public.purchase_orders set status=v_status where id=v_po.id;
end; $$;

create or replace function public.create_rma_and_receive(p_org_id uuid,p_sales_order_id uuid,p_customer_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=uuid_generate_v4(); v_number text; v_line record;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  select coalesce(max(nullif(regexp_replace(rma_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.rmas where org_id=p_org_id;
  insert into public.rmas(id,org_id,rma_number,sales_order_id,customer_name,status,created_by,updated_by) values(v_id,p_org_id,'RMA'||v_number,p_sales_order_id,nullif(p_customer_name,''),'RECEIVED',auth.uid(),auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid,location_id uuid,quantity integer,disposition text,reason text) loop
    if v_line.quantity is null or v_line.quantity<=0 or v_line.disposition not in ('QUARANTINE','REPAIR') or nullif(btrim(v_line.reason),'') is null then raise exception 'invalid RMA line'; end if;
    insert into public.rma_items(rma_id,product_id,location_id,quantity_received,disposition,reason) values(v_id,v_line.product_id,v_line.location_id,v_line.quantity,v_line.disposition,v_line.reason);
    insert into public.inventory_balances(product_id,location_id,lot_number,quantity_quarantined) values(v_line.product_id,v_line.location_id,'',v_line.quantity) on conflict(product_id,location_id,lot_number) do update set quantity_quarantined=public.inventory_balances.quantity_quarantined+excluded.quantity_quarantined,updated_at=now();
  end loop; return v_id;
end; $$;

create or replace function public.submit_cycle_count(p_org_id uuid,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=uuid_generate_v4(); v_number text; v_line record; v_system integer;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  select coalesce(max(nullif(regexp_replace(count_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.cycle_counts where org_id=p_org_id;
  insert into public.cycle_counts(id,org_id,count_number,counted_by) values(v_id,p_org_id,'CC'||v_number,auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid,location_id uuid,physical_quantity integer,reason_code text) loop
    select coalesce(sum(b.quantity_on_hand),0) into v_system from public.inventory_balances b join public.products p on p.id=b.product_id where b.product_id=v_line.product_id and b.location_id=v_line.location_id and p.org_id=p_org_id;
    if v_line.physical_quantity is null or v_line.physical_quantity<0 or (v_line.physical_quantity<>v_system and coalesce(v_line.reason_code,'') not in ('DAMAGED','MISSING','MISPLACED','COUNT_ERROR','OTHER')) then raise exception 'a reason code is required for every discrepancy'; end if;
    insert into public.cycle_count_items(cycle_count_id,product_id,location_id,system_quantity,physical_quantity,reason_code) values(v_id,v_line.product_id,v_line.location_id,v_system,v_line.physical_quantity,nullif(v_line.reason_code,''));
  end loop; return v_id;
end; $$;

create or replace function public.approve_cycle_count(p_cycle_count_id uuid,p_approve boolean)
returns void language plpgsql security definer set search_path=public as $$
declare v_count public.cycle_counts%rowtype; v_item record; v_delta integer; v_warehouse_id uuid;
begin
  select * into v_count from public.cycle_counts where id=p_cycle_count_id for update; if v_count.id is null then raise exception 'cycle count not found'; end if;
  if not public.is_org_role(v_count.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_count.status<>'PENDING_APPROVAL' then raise exception 'cycle count has already been reconciled'; end if;
  if not p_approve then update public.cycle_counts set status='REJECTED',approved_by=auth.uid(),approved_at=now() where id=v_count.id; return; end if;
  for v_item in select * from public.cycle_count_items where cycle_count_id=v_count.id loop
    v_delta:=v_item.physical_quantity-v_item.system_quantity;
    insert into public.inventory_balances(product_id,location_id,lot_number,quantity_on_hand) values(v_item.product_id,v_item.location_id,'',v_item.physical_quantity) on conflict(product_id,location_id,lot_number) do update set quantity_on_hand=excluded.quantity_on_hand,updated_at=now();
    if v_delta<>0 then select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_item.location_id; insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_count.org_id,v_warehouse_id,v_item.product_id,v_item.location_id,'ADJUSTMENT',v_delta,'CYCLE_COUNT',v_count.id,v_item.reason_code,auth.uid()); end if;
  end loop;
  update public.cycle_counts set status='APPROVED',approved_by=auth.uid(),approved_at=now() where id=v_count.id;
end; $$;

create or replace function public.fulfill_sales_order_partial(p_sales_order_id uuid,p_lines jsonb)
returns void language plpgsql security definer set search_path=public as $$
declare v_order public.sales_orders%rowtype; v_line record; v_item public.order_items%rowtype; v_allocation record; v_remaining integer; v_take integer; v_warehouse_id uuid;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('ALLOCATED','PARTIALLY_SHIPPED') then raise exception 'only allocated sales orders can be partially shipped'; end if;
  for v_line in select * from jsonb_to_recordset(p_lines) as x(order_item_id uuid,quantity integer) loop
    if v_line.quantity is null or v_line.quantity<=0 then raise exception 'invalid shipment quantity'; end if;
    select * into v_item from public.order_items where id=v_line.order_item_id and sales_order_id=v_order.id for update;
    if v_item.id is null then raise exception 'shipment line is not part of this sales order'; end if;
    if exists(select 1 from public.products where id=v_item.product_id and is_serialized) then raise exception 'serialised items must be fulfilled through the serial scanning workflow'; end if;
    if v_line.quantity > v_item.quantity_reserved-v_item.quantity_picked then raise exception 'shipment quantity exceeds the allocated balance'; end if;
    v_remaining:=v_line.quantity;
    for v_allocation in select a.*,b.product_id,b.location_id from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id where a.order_item_id=v_item.id and a.quantity_fulfilled<a.quantity_reserved order by a.id for update loop
      v_take:=least(v_remaining,v_allocation.quantity_reserved-v_allocation.quantity_fulfilled); if v_take<=0 then continue; end if;
      update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_take,quantity_reserved=quantity_reserved-v_take,updated_at=now() where id=v_allocation.inventory_balance_id;
      update public.order_item_allocations set quantity_fulfilled=quantity_fulfilled+v_take where id=v_allocation.id;
      update public.order_items set quantity_picked=quantity_picked+v_take where id=v_item.id;
      select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_allocation.location_id;
      insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_order.org_id,v_warehouse_id,v_allocation.product_id,v_allocation.location_id,'OUTBOUND',-v_take,'SALES_ORDER',v_order.id,'Partial sales order fulfillment',auth.uid());
      v_remaining:=v_remaining-v_take; exit when v_remaining=0;
    end loop;
  end loop;
  update public.sales_orders set status=case when not exists(select 1 from public.order_items where sales_order_id=v_order.id and quantity_picked<quantity_requested) then 'SHIPPED' else 'PARTIALLY_SHIPPED' end where id=v_order.id;
end; $$;

create or replace function public.dispatch_return_to_vendor(p_rtv_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_rtv public.return_to_vendor%rowtype; v_item record;
begin
  select * into v_rtv from public.return_to_vendor where id=p_rtv_id for update; if v_rtv.id is null then raise exception 'RTV not found'; end if;
  if not public.is_org_role(v_rtv.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_rtv.status<>'PENDING' then raise exception 'only pending RTV records can be dispatched'; end if;
  for v_item in select * from public.return_to_vendor_items where rtv_id=v_rtv.id loop
    update public.inventory_balances set quantity_quarantined=quantity_quarantined-v_item.quantity,updated_at=now() where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='' and quantity_quarantined>=v_item.quantity;
    if not found then raise exception 'insufficient quarantined stock for RTV dispatch'; end if;
  end loop;
  update public.return_to_vendor set status='SHIPPED',updated_by=auth.uid() where id=v_rtv.id;
end; $$;

create or replace function public.create_return_to_vendor(p_org_id uuid,p_supplier_name text,p_lines jsonb)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid:=uuid_generate_v4(); v_number text; v_line record;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if nullif(btrim(p_supplier_name),'') is null then raise exception 'supplier name is required'; end if;
  select coalesce(max(nullif(regexp_replace(rtv_number,'[^0-9]','','g'), '')::integer),0)+1 into v_number from public.return_to_vendor where org_id=p_org_id;
  insert into public.return_to_vendor(id,org_id,rtv_number,supplier_name,created_by,updated_by) values(v_id,p_org_id,'RTV'||v_number,btrim(p_supplier_name),auth.uid(),auth.uid());
  for v_line in select * from jsonb_to_recordset(p_lines) as x(product_id uuid,location_id uuid,quantity integer,reason text) loop
    if v_line.quantity is null or v_line.quantity<=0 or nullif(btrim(v_line.reason),'') is null then raise exception 'invalid RTV line'; end if;
    if not exists(select 1 from public.inventory_balances where product_id=v_line.product_id and location_id=v_line.location_id and lot_number='' and quantity_quarantined>=v_line.quantity) then raise exception 'RTV quantity exceeds quarantined stock'; end if;
    insert into public.return_to_vendor_items(rtv_id,product_id,location_id,quantity,reason) values(v_id,v_line.product_id,v_line.location_id,v_line.quantity,btrim(v_line.reason));
  end loop; return v_id;
end; $$;

create or replace function public.log_mispick_attempt(p_org_id uuid,p_sales_order_id uuid,p_order_item_id uuid,p_scanned_value text,p_reason_code text)
returns void language plpgsql security definer set search_path=public as $$
declare v_product uuid;
begin
  if not public.is_org_role(p_org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  select product_id into v_product from public.order_items where id=p_order_item_id and sales_order_id=p_sales_order_id;
  if v_product is null then raise exception 'order line not found'; end if;
  if p_reason_code not in ('WRONG_SKU','WRONG_SERIAL','WRONG_BIN','NOT_ALLOCATED') or nullif(btrim(p_scanned_value),'') is null then raise exception 'invalid mispick attempt'; end if;
  insert into public.mispick_attempts(org_id,sales_order_id,order_item_id,scanned_value,expected_product_id,reason_code,user_id) values(p_org_id,p_sales_order_id,p_order_item_id,left(btrim(p_scanned_value),160),v_product,p_reason_code,auth.uid());
end; $$;

alter table public.mispick_attempts enable row level security; alter table public.return_to_vendor enable row level security; alter table public.return_to_vendor_items enable row level security; alter table public.rmas enable row level security; alter table public.rma_items enable row level security; alter table public.cycle_counts enable row level security; alter table public.cycle_count_items enable row level security;
drop policy if exists mispicks_read on public.mispick_attempts;
drop policy if exists rtv_read on public.return_to_vendor;
drop policy if exists rma_read on public.rmas;
drop policy if exists cycle_read on public.cycle_counts;
drop policy if exists rtv_items_read on public.return_to_vendor_items;
drop policy if exists rma_items_read on public.rma_items;
drop policy if exists cycle_items_read on public.cycle_count_items;
create policy mispicks_read on public.mispick_attempts for select using (public.is_org_member(org_id));
create policy rtv_read on public.return_to_vendor for select using (public.is_org_member(org_id));
create policy rma_read on public.rmas for select using (public.is_org_member(org_id));
create policy cycle_read on public.cycle_counts for select using (public.is_org_member(org_id));
create policy rtv_items_read on public.return_to_vendor_items for select using (exists(select 1 from public.return_to_vendor r where r.id=rtv_id and public.is_org_member(r.org_id)));
create policy rma_items_read on public.rma_items for select using (exists(select 1 from public.rmas r where r.id=rma_id and public.is_org_member(r.org_id)));
create policy cycle_items_read on public.cycle_count_items for select using (exists(select 1 from public.cycle_counts c where c.id=cycle_count_id and public.is_org_member(c.org_id)));
