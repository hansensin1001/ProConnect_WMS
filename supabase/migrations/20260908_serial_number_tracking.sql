-- End-to-end serial-number tracking for ProConnect WMS.
-- Run after schema.sql and 20260908_performance_indexes.sql.

alter table public.products
  add column if not exists is_serialized boolean not null default false;

create or replace function public.prevent_serialisation_change_with_stock()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.is_serialized is distinct from old.is_serialized
     and exists (select 1 from public.inventory_balances where product_id=old.id and (quantity_on_hand<>0 or quantity_reserved<>0)) then
    raise exception 'serialized tracking cannot be changed while the SKU has stock; clear or reconcile its stock first';
  end if;
  return new;
end;
$$;
drop trigger if exists products_serialisation_change_guard on public.products;
create trigger products_serialisation_change_guard before update of is_serialized on public.products
  for each row execute function public.prevent_serialisation_change_with_stock();

create table if not exists public.serial_numbers (
  id uuid primary key default uuid_generate_v4(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  purchase_order_item_id uuid references public.purchase_order_items(id) on delete set null,
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  sales_order_item_id uuid references public.order_items(id) on delete set null,
  serial_number varchar(160) not null,
  status varchar(20) not null default 'IN_STOCK'
    check (status in ('IN_STOCK', 'SHIPPED', 'VOIDED')),
  received_at timestamptz not null default now(),
  shipped_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create unique index if not exists serial_numbers_org_serial_number_key
  on public.serial_numbers (org_id, lower(serial_number));
create index if not exists idx_serial_numbers_available
  on public.serial_numbers (org_id, product_id, location_id)
  where status = 'IN_STOCK';
create index if not exists idx_serial_numbers_purchase_item
  on public.serial_numbers (purchase_order_item_id);
create index if not exists idx_serial_numbers_sales_order
  on public.serial_numbers (sales_order_id);

alter table public.serial_numbers enable row level security;
drop policy if exists serial_numbers_read on public.serial_numbers;
create policy serial_numbers_read on public.serial_numbers for select
  using (public.is_org_member(org_id));
-- There is intentionally no direct write policy. Receipts, shipment and
-- rollback must use the validated security-definer functions below.

drop trigger if exists serial_numbers_record_audit on public.serial_numbers;
create trigger serial_numbers_record_audit before insert or update on public.serial_numbers
  for each row execute function public.apply_record_audit();

-- A serialised receipt is atomic: stock is not posted unless every serialised
-- PO line has exactly one unique serial for each received unit.
drop function if exists public.receive_purchase_order(uuid);
create function public.receive_purchase_order(
  p_purchase_order_id uuid,
  p_serials jsonb default '[]'::jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_item record;
  v_serial record;
  v_serial_count integer;
begin
  if jsonb_typeof(coalesce(p_serials, '[]'::jsonb)) <> 'array' then
    raise exception 'serial numbers must be supplied as a list';
  end if;
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status <> 'PENDING' then raise exception 'only pending purchase orders can be received'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_serials) as s(purchase_order_item_id uuid, serial_number text)
    left join public.purchase_order_items poi on poi.id = s.purchase_order_item_id
    where poi.id is null or poi.purchase_order_id <> p_purchase_order_id
       or nullif(btrim(s.serial_number), '') is null or length(btrim(s.serial_number)) > 160
  ) then raise exception 'invalid serial number assignment'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_serials) as s(purchase_order_item_id uuid, serial_number text)
    group by lower(btrim(s.serial_number)) having count(*) > 1
  ) then raise exception 'duplicate serial number scanned'; end if;

  for v_item in
    select poi.*, p.is_serialized, z.warehouse_id
    from public.purchase_order_items poi
    join public.products p on p.id = poi.product_id
    join public.locations l on l.id = poi.location_id
    join public.warehouse_zones z on z.id = l.zone_id
    where poi.purchase_order_id = p_purchase_order_id
    for update of poi
  loop
    select count(*) into v_serial_count
    from jsonb_to_recordset(p_serials) as s(purchase_order_item_id uuid, serial_number text)
    where s.purchase_order_item_id = v_item.id;
    if v_item.is_serialized and v_serial_count <> v_item.quantity_expected then
      raise exception 'serialised SKU requires exactly % serial numbers for receipt', v_item.quantity_expected;
    end if;
    if not v_item.is_serialized and v_serial_count <> 0 then
      raise exception 'serial numbers were provided for a non-serialised SKU';
    end if;

    if v_item.is_serialized then
      for v_serial in
        select upper(btrim(s.serial_number)) as serial_number
        from jsonb_to_recordset(p_serials) as s(purchase_order_item_id uuid, serial_number text)
        where s.purchase_order_item_id = v_item.id
      loop
        if exists (
          select 1 from public.serial_numbers sn
          where sn.org_id = v_po.org_id and lower(sn.serial_number) = lower(v_serial.serial_number)
        ) then raise exception 'serial number % already exists in this organization', v_serial.serial_number; end if;
        insert into public.serial_numbers(
          org_id, product_id, location_id, purchase_order_id, purchase_order_item_id, serial_number, status
        ) values (
          v_po.org_id, v_item.product_id, v_item.location_id, v_po.id, v_item.id, v_serial.serial_number, 'IN_STOCK'
        );
      end loop;
    end if;

    insert into public.inventory_balances(product_id, location_id, lot_number, quantity_on_hand)
      values(v_item.product_id, v_item.location_id, '', v_item.quantity_expected)
      on conflict (product_id, location_id, lot_number) do update
        set quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand,
            updated_at = now();
    update public.purchase_order_items set quantity_received = quantity_expected where id = v_item.id;
    insert into public.inventory_transactions(
      org_id, warehouse_id, product_id, location_id, transaction_type,
      quantity_delta, reference_type, reference_id, reason, user_id
    ) values (
      v_po.org_id, v_item.warehouse_id, v_item.product_id, v_item.location_id, 'INBOUND',
      v_item.quantity_expected, 'PURCHASE_ORDER', v_po.id, 'PO receipt', auth.uid()
    );
  end loop;
  update public.purchase_orders set status = 'RECEIVED' where id = p_purchase_order_id;
end;
$$;

-- Serialised SKUs may reserve only a bin containing sufficient IN_STOCK serials.
create or replace function public.allocate_sales_order(p_sales_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.sales_orders%rowtype;
  v_item record;
  v_balance record;
  v_remaining integer;
  v_available integer;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status <> 'NEW' then raise exception 'only new orders can be allocated'; end if;
  for v_item in
    select oi.*, p.is_serialized from public.order_items oi join public.products p on p.id=oi.product_id
    where oi.sales_order_id=p_sales_order_id
  loop
    if v_item.is_serialized then
      select coalesce(sum(least(b.quantity_on_hand - b.quantity_reserved, serials.available)), 0)
        into v_available
      from public.inventory_balances b
      cross join lateral (
        select count(*)::integer as available from public.serial_numbers sn
        where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id
          and sn.location_id=b.location_id and sn.status='IN_STOCK'
      ) serials
      where b.product_id=v_item.product_id and b.lot_number='' and b.quantity_on_hand>b.quantity_reserved;
    else
      select coalesce(sum(quantity_on_hand-quantity_reserved),0) into v_available
      from public.inventory_balances where product_id=v_item.product_id;
    end if;
    if v_available < v_item.quantity_requested then raise exception 'insufficient available stock for product %', v_item.product_id; end if;
    v_remaining := v_item.quantity_requested;
    if v_item.is_serialized then
      for v_balance in
        select b.id, b.quantity_on_hand, b.quantity_reserved,
          (select count(*)::integer from public.serial_numbers sn where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id and sn.location_id=b.location_id and sn.status='IN_STOCK') as serial_available
        from public.inventory_balances b
        where b.product_id=v_item.product_id and b.lot_number='' and b.quantity_on_hand>b.quantity_reserved
        order by b.updated_at, b.id for update
      loop
        exit when v_remaining=0;
        v_available := least(v_remaining, v_balance.quantity_on_hand-v_balance.quantity_reserved, v_balance.serial_available);
        if v_available <= 0 then continue; end if;
        update public.inventory_balances set quantity_reserved=quantity_reserved+v_available,updated_at=now() where id=v_balance.id;
        insert into public.order_item_allocations(order_item_id,inventory_balance_id,quantity_reserved) values(v_item.id,v_balance.id,v_available);
        v_remaining:=v_remaining-v_available;
      end loop;
    else
      for v_balance in select id, quantity_on_hand, quantity_reserved from public.inventory_balances where product_id=v_item.product_id and quantity_on_hand>quantity_reserved order by updated_at,id for update loop
        exit when v_remaining=0;
        v_available:=least(v_remaining,v_balance.quantity_on_hand-v_balance.quantity_reserved);
        update public.inventory_balances set quantity_reserved=quantity_reserved+v_available,updated_at=now() where id=v_balance.id;
        insert into public.order_item_allocations(order_item_id,inventory_balance_id,quantity_reserved) values(v_item.id,v_balance.id,v_available);
        v_remaining:=v_remaining-v_available;
      end loop;
    end if;
    if v_remaining>0 then raise exception 'insufficient available stock for product %', v_item.product_id; end if;
    update public.order_items set quantity_reserved=quantity_requested where id=v_item.id;
  end loop;
  update public.sales_orders set status='ALLOCATED' where id=p_sales_order_id;
end;
$$;

create or replace function public.fulfill_sales_order_with_serials(
  p_sales_order_id uuid,
  p_serials jsonb default '[]'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.sales_orders%rowtype;
  v_item record;
  v_allocation record;
  v_entry record;
  v_serial public.serial_numbers%rowtype;
  v_count integer;
  v_warehouse_id uuid;
begin
  if jsonb_typeof(coalesce(p_serials, '[]'::jsonb)) <> 'array' then raise exception 'serial numbers must be supplied as a list'; end if;
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status <> 'ALLOCATED' then raise exception 'only allocated orders can be fulfilled'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_serials) as s(order_item_id uuid, serial_number text)
    left join public.order_items oi on oi.id=s.order_item_id
    where oi.id is null or oi.sales_order_id<>p_sales_order_id
       or nullif(btrim(s.serial_number),'') is null or length(btrim(s.serial_number))>160
  ) then raise exception 'invalid serial number assignment'; end if;
  if exists (
    select 1 from jsonb_to_recordset(p_serials) as s(order_item_id uuid, serial_number text)
    group by lower(btrim(s.serial_number)) having count(*)>1
  ) then raise exception 'duplicate serial number scanned'; end if;

  for v_item in
    select oi.*, p.is_serialized from public.order_items oi join public.products p on p.id=oi.product_id
    where oi.sales_order_id=p_sales_order_id for update of oi
  loop
    select count(*) into v_count from jsonb_to_recordset(p_serials) as s(order_item_id uuid, serial_number text) where s.order_item_id=v_item.id;
    if v_item.is_serialized and v_count<>v_item.quantity_reserved then
      raise exception 'serialised SKU requires exactly % scanned serial numbers before shipment', v_item.quantity_reserved;
    end if;
    if not v_item.is_serialized and v_count<>0 then raise exception 'serial numbers were provided for a non-serialised SKU'; end if;
    if v_item.is_serialized then
      for v_entry in select upper(btrim(s.serial_number)) as serial_number from jsonb_to_recordset(p_serials) as s(order_item_id uuid, serial_number text) where s.order_item_id=v_item.id loop
        select * into v_serial from public.serial_numbers sn
          where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id and lower(sn.serial_number)=lower(v_entry.serial_number)
          for update;
        if v_serial.id is null or v_serial.status<>'IN_STOCK' then raise exception 'serial number % is not available in stock', v_entry.serial_number; end if;
        if not exists (
          select 1 from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id
          where a.order_item_id=v_item.id and b.location_id=v_serial.location_id
        ) then raise exception 'serial number % is not in an allocated bin for this order', v_entry.serial_number; end if;
      end loop;
      for v_allocation in
        select a.*, b.location_id from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id
        where a.order_item_id=v_item.id
      loop
        select count(*) into v_count
        from jsonb_to_recordset(p_serials) as s(order_item_id uuid, serial_number text)
        join public.serial_numbers sn on sn.org_id=v_order.org_id and lower(sn.serial_number)=lower(btrim(s.serial_number))
        where s.order_item_id=v_item.id and sn.location_id=v_allocation.location_id;
        if v_count>v_allocation.quantity_reserved then raise exception 'too many scanned serial numbers belong to one allocated bin'; end if;
      end loop;
    end if;
  end loop;

  update public.serial_numbers sn set status='SHIPPED', sales_order_id=p_sales_order_id,
    sales_order_item_id=s.order_item_id, shipped_at=now()
  from jsonb_to_recordset(p_serials) as s(order_item_id uuid, serial_number text)
  where sn.org_id=v_order.org_id and lower(sn.serial_number)=lower(btrim(s.serial_number));

  for v_allocation in
    select a.*, b.product_id, b.location_id from public.order_item_allocations a
    join public.inventory_balances b on b.id=a.inventory_balance_id
    join public.order_items oi on oi.id=a.order_item_id
    where oi.sales_order_id=p_sales_order_id for update
  loop
    update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_allocation.quantity_reserved,
      quantity_reserved=quantity_reserved-v_allocation.quantity_reserved,updated_at=now()
      where id=v_allocation.inventory_balance_id;
    update public.order_item_allocations set quantity_fulfilled=quantity_reserved where id=v_allocation.id;
    update public.order_items set quantity_picked=quantity_picked+v_allocation.quantity_reserved where id=v_allocation.order_item_id;
    select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_allocation.location_id;
    insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id)
      values(v_order.org_id,v_warehouse_id,v_allocation.product_id,v_allocation.location_id,'OUTBOUND',-v_allocation.quantity_reserved,'SALES_ORDER',v_order.id,'Sales order fulfillment',auth.uid());
  end loop;
  update public.sales_orders set status='SHIPPED' where id=p_sales_order_id;
end;
$$;

-- Keep the original public RPC safe for older clients: serialised orders are
-- rejected unless callers use the validated serial-aware function above.
create or replace function public.fulfill_sales_order(p_sales_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.fulfill_sales_order_with_serials(p_sales_order_id, '[]'::jsonb);
end;
$$;

create or replace function public.rollback_sales_order(p_sales_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_item record; v_allocation record; v_warehouse_id uuid; v_remaining integer; v_return_quantity integer;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('ALLOCATED','SHIPPED') then raise exception 'only allocated or shipped sales orders can be rolled back'; end if;
  for v_item in select * from public.order_items where sales_order_id=p_sales_order_id for update loop
    v_remaining:=least(v_item.quantity_requested,case when v_order.status='SHIPPED' then v_item.quantity_picked else v_item.quantity_reserved end);
    for v_allocation in select a.*,b.product_id,b.location_id from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id where a.order_item_id=v_item.id order by a.id for update loop
      exit when v_remaining<=0;
      v_return_quantity:=least(v_remaining,case when v_order.status='SHIPPED' then v_allocation.quantity_fulfilled else v_allocation.quantity_reserved end);
      if v_return_quantity<=0 then continue; end if;
      if v_order.status='SHIPPED' then
        update public.inventory_balances set quantity_on_hand=quantity_on_hand+v_return_quantity where id=v_allocation.inventory_balance_id;
        select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_allocation.location_id;
        insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_order.org_id,v_warehouse_id,v_allocation.product_id,v_allocation.location_id,'INBOUND',v_return_quantity,'SALES_ORDER',v_order.id,'Sales order rollback',auth.uid());
      else update public.inventory_balances set quantity_reserved=quantity_reserved-v_return_quantity where id=v_allocation.inventory_balance_id;
      end if;
      v_remaining:=v_remaining-v_return_quantity;
    end loop;
  end loop;
  if v_order.status='SHIPPED' then
    update public.serial_numbers set status='IN_STOCK',sales_order_id=null,sales_order_item_id=null,shipped_at=null where sales_order_id=p_sales_order_id and status='SHIPPED';
  end if;
  update public.order_items set quantity_reserved=0,quantity_picked=case when v_order.status='SHIPPED' then 0 else quantity_picked end where sales_order_id=p_sales_order_id;
  delete from public.order_item_allocations where order_item_id in(select id from public.order_items where sales_order_id=p_sales_order_id);
  update public.sales_orders set status='REVERTED' where id=p_sales_order_id;
end;
$$;

create or replace function public.rollback_purchase_order(p_purchase_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_po public.purchase_orders%rowtype; v_item record;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status='PENDING' then update public.purchase_orders set status='CANCELLED' where id=p_purchase_order_id; return; end if;
  if v_po.status not in('RECEIVED','COMPLETED') then raise exception 'only pending or received purchase orders can be rolled back'; end if;
  if exists(select 1 from public.serial_numbers where purchase_order_id=p_purchase_order_id and status='SHIPPED') then raise exception 'a shipped serial number prevents this purchase-order rollback'; end if;
  for v_item in select poi.*,z.warehouse_id from public.purchase_order_items poi join public.locations l on l.id=poi.location_id join public.warehouse_zones z on z.id=l.zone_id where poi.purchase_order_id=p_purchase_order_id loop
    if not exists(select 1 from public.inventory_balances where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='' and quantity_on_hand-v_item.quantity_received>=quantity_reserved) then raise exception 'purchase-order rollback would make bin stock lower than reserved stock'; end if;
    update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_item.quantity_received where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='';
    update public.purchase_order_items set quantity_received=0 where id=v_item.id;
    insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_po.org_id,v_item.warehouse_id,v_item.product_id,v_item.location_id,'OUTBOUND',-v_item.quantity_received,'PURCHASE_ORDER',v_po.id,'Purchase order rollback',auth.uid());
  end loop;
  update public.serial_numbers set status='VOIDED' where purchase_order_id=p_purchase_order_id and status='IN_STOCK';
  update public.purchase_orders set status='REVERTED' where id=p_purchase_order_id;
end;
$$;
