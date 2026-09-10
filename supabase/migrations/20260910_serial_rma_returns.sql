-- Serialized customer returns must identify the exact unit that was shipped.
-- The immutable RMA/serial link preserves warranty and audit history even if
-- the serial is later restocked and shipped again.
create extension if not exists pgcrypto;

alter table public.serial_numbers
  add column if not exists rma_id uuid references public.rmas(id) on delete set null,
  add column if not exists returned_at timestamptz,
  add column if not exists rtv_id uuid references public.return_to_vendor(id) on delete set null,
  add column if not exists vendor_returned_at timestamptz;

alter table public.serial_numbers drop constraint if exists serial_numbers_status_check;
alter table public.serial_numbers add constraint serial_numbers_status_check
  check (status in ('IN_STOCK', 'SHIPPED', 'VOIDED', 'QUARANTINED', 'RTV_PENDING'));

create index if not exists idx_serial_numbers_rma on public.serial_numbers(rma_id)
  where rma_id is not null;
create index if not exists idx_serial_numbers_rtv on public.serial_numbers(rtv_id)
  where rtv_id is not null;

create table if not exists public.rma_serial_numbers (
  id uuid primary key default gen_random_uuid(),
  rma_id uuid not null references public.rmas(id) on delete cascade,
  rma_item_id uuid not null references public.rma_items(id) on delete cascade,
  serial_id uuid not null references public.serial_numbers(id) on delete restrict,
  serial_number varchar(160) not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(rma_item_id, serial_id)
);
create index if not exists idx_rma_serial_numbers_rma on public.rma_serial_numbers(rma_id);

create table if not exists public.rtv_serial_numbers (
  id uuid primary key default gen_random_uuid(),
  rtv_id uuid not null references public.return_to_vendor(id) on delete cascade,
  rtv_item_id uuid not null references public.return_to_vendor_items(id) on delete cascade,
  serial_id uuid not null references public.serial_numbers(id) on delete restrict,
  serial_number varchar(160) not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  unique(rtv_item_id, serial_id)
);
create index if not exists idx_rtv_serial_numbers_rtv on public.rtv_serial_numbers(rtv_id);

alter table public.rma_serial_numbers enable row level security;
drop policy if exists rma_serial_numbers_read on public.rma_serial_numbers;
create policy rma_serial_numbers_read on public.rma_serial_numbers for select
  using (exists (
    select 1 from public.rmas r
    where r.id = rma_id and public.is_org_member(r.org_id)
  ));

alter table public.rtv_serial_numbers enable row level security;
drop policy if exists rtv_serial_numbers_read on public.rtv_serial_numbers;
create policy rtv_serial_numbers_read on public.rtv_serial_numbers for select
  using (exists (
    select 1 from public.return_to_vendor r
    where r.id = rtv_id and public.is_org_member(r.org_id)
  ));

create or replace function public.create_rma_and_receive(
  p_org_id uuid,
  p_sales_order_id uuid,
  p_customer_name text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_number integer;
  v_line record;
  v_rma_item_id uuid;
  v_zone_type text;
  v_warehouse_id uuid;
  v_shipped_qty integer;
  v_already_returned integer;
  v_is_serialized boolean;
  v_serial_count integer;
  v_distinct_serial_count integer;
  v_matching_shipped_serials integer;
begin
  if not public.is_org_role(p_org_id, array['owner', 'manager']) then
    raise exception 'manager or owner access is required';
  end if;
  if p_sales_order_id is null or not exists (
    select 1 from public.sales_orders
    where id = p_sales_order_id and org_id = p_org_id and status = 'SHIPPED'
  ) then
    raise exception 'RMA requires a verified shipped sales order';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'at least one RMA line is required';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'at least one RMA line is required';
  end if;

  select coalesce(max(nullif(regexp_replace(rma_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
    into v_number
  from public.rmas
  where org_id = p_org_id;

  insert into public.rmas(id, org_id, rma_number, sales_order_id, customer_name, status, created_by, updated_by)
  values (v_id, p_org_id, 'RMA' || v_number, p_sales_order_id, nullif(btrim(p_customer_name), ''), 'RECEIVED', auth.uid(), auth.uid());

  for v_line in
    select *
    from jsonb_to_recordset(p_lines) as x(
      product_id uuid,
      location_id uuid,
      quantity integer,
      disposition text,
      reason text,
      serial_numbers jsonb
    )
  loop
    if v_line.quantity is null or v_line.quantity <= 0
      or v_line.disposition not in ('PUTAWAY', 'QUARANTINE')
      or nullif(btrim(v_line.reason), '') is null then
      raise exception 'invalid RMA line';
    end if;

    select p.is_serialized into v_is_serialized
    from public.products p
    where p.id = v_line.product_id and p.org_id = p_org_id;
    if v_is_serialized is null then
      raise exception 'RMA SKU is not available in the active organization';
    end if;
    if not exists (
      select 1 from public.order_items
      where sales_order_id = p_sales_order_id and product_id = v_line.product_id
    ) then
      raise exception 'RMA SKU was not shipped on the selected sales order';
    end if;

    select coalesce(sum(quantity_requested), 0) into v_shipped_qty
    from public.order_items
    where sales_order_id = p_sales_order_id and product_id = v_line.product_id;
    select coalesce(sum(ri.quantity_received), 0) into v_already_returned
    from public.rma_items ri
    join public.rmas r on r.id = ri.rma_id
    where r.sales_order_id = p_sales_order_id
      and ri.product_id = v_line.product_id
      and r.status <> 'CANCELLED';
    if v_line.quantity + v_already_returned > v_shipped_qty then
      raise exception 'RMA quantity exceeds the shipped quantity for this sales order';
    end if;

    select z.zone_type, z.warehouse_id into v_zone_type, v_warehouse_id
    from public.locations l
    join public.warehouse_zones z on z.id = l.zone_id
    join public.warehouses w on w.id = z.warehouse_id
    where l.id = v_line.location_id and w.org_id = p_org_id;
    if v_line.disposition = 'QUARANTINE' and coalesce(v_zone_type, '') <> 'QUARANTINE' then
      raise exception 'select a bin in a QUARANTINE zone for damaged returns';
    end if;
    if v_line.disposition = 'PUTAWAY' and coalesce(v_zone_type, '') <> 'STORAGE' then
      raise exception 'select a STORAGE bin for restockable returns';
    end if;

    if v_is_serialized then
      if jsonb_typeof(coalesce(v_line.serial_numbers, '[]'::jsonb)) <> 'array' then
        raise exception 'serialized RMA SKU requires scanned serial numbers';
      end if;
      select count(*), count(distinct lower(btrim(value)))
        into v_serial_count, v_distinct_serial_count
      from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      where btrim(value) <> '';
      if v_serial_count <> v_line.quantity or v_distinct_serial_count <> v_line.quantity then
        raise exception 'serialized RMA SKU requires exactly % unique scanned serial numbers', v_line.quantity;
      end if;

      -- Lock and validate only serials actually shipped on this SO. A serial
      -- from another SO, a duplicate, or an already returned unit is rejected.
      perform 1
      from public.serial_numbers sn
      join (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested on requested.serial_number = lower(sn.serial_number)
      where sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.sales_order_id = p_sales_order_id
        and sn.status = 'SHIPPED'
      for update of sn;

      select count(*) into v_matching_shipped_serials
      from public.serial_numbers sn
      join (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested on requested.serial_number = lower(sn.serial_number)
      where sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.sales_order_id = p_sales_order_id
        and sn.status = 'SHIPPED';
      if v_matching_shipped_serials <> v_line.quantity then
        raise exception 'one or more scanned serial numbers were not shipped on this sales order';
      end if;
    elsif v_line.serial_numbers is not null then
      if jsonb_typeof(v_line.serial_numbers) <> 'array' then
        raise exception 'serial numbers must be supplied as a list';
      end if;
      if jsonb_array_length(v_line.serial_numbers) <> 0 then
        raise exception 'serial numbers were provided for a non-serialized RMA SKU';
      end if;
    end if;

    insert into public.rma_items(rma_id, product_id, location_id, quantity_received, disposition, reason)
    values (v_id, v_line.product_id, v_line.location_id, v_line.quantity, v_line.disposition, btrim(v_line.reason))
    returning id into v_rma_item_id;

    if v_is_serialized then
      insert into public.rma_serial_numbers(rma_id, rma_item_id, serial_id, serial_number, created_by)
      select v_id, v_rma_item_id, sn.id, sn.serial_number, auth.uid()
      from public.serial_numbers sn
      join (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested on requested.serial_number = lower(sn.serial_number)
      where sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.sales_order_id = p_sales_order_id
        and sn.status = 'SHIPPED';

      update public.serial_numbers sn
      set location_id = v_line.location_id,
          status = case when v_line.disposition = 'PUTAWAY' then 'IN_STOCK' else 'QUARANTINED' end,
          rma_id = v_id,
          returned_at = now(),
          updated_by = auth.uid()
      from (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested
      where lower(sn.serial_number) = requested.serial_number
        and sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.sales_order_id = p_sales_order_id
        and sn.status = 'SHIPPED';
    end if;

    if v_line.disposition = 'PUTAWAY' then
      insert into public.inventory_balances(product_id, location_id, lot_number, quantity_on_hand)
      values (v_line.product_id, v_line.location_id, '', v_line.quantity)
      on conflict(product_id, location_id, lot_number) do update
        set quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand,
            updated_at = now();
      insert into public.inventory_transactions(org_id, warehouse_id, product_id, location_id, transaction_type, quantity_delta, reference_type, reference_id, reason, user_id)
      values (p_org_id, v_warehouse_id, v_line.product_id, v_line.location_id, 'INBOUND', v_line.quantity, 'CUSTOMER_RETURN', v_id, btrim(v_line.reason), auth.uid());
    else
      insert into public.inventory_balances(product_id, location_id, lot_number, quantity_quarantined)
      values (v_line.product_id, v_line.location_id, '', v_line.quantity)
      on conflict(product_id, location_id, lot_number) do update
        set quantity_quarantined = public.inventory_balances.quantity_quarantined + excluded.quantity_quarantined,
            updated_at = now();
    end if;
  end loop;

  return v_id;
end;
$$;

-- Serialized RTVs use the same exact-unit control as RMAs. A pending RTV
-- records the selected serials; dispatch is the moment they leave stock.
create or replace function public.create_return_to_vendor(
  p_org_id uuid,
  p_supplier_name text,
  p_lines jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid := gen_random_uuid();
  v_number integer;
  v_line record;
  v_rtv_item_id uuid;
  v_is_serialized boolean;
  v_serial_count integer;
  v_distinct_serial_count integer;
  v_matching_serial_count integer;
begin
  if not public.is_org_role(p_org_id, array['owner', 'manager']) then
    raise exception 'manager or owner access is required';
  end if;
  if nullif(btrim(p_supplier_name), '') is null then
    raise exception 'supplier name is required';
  end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then
    raise exception 'at least one RTV line is required';
  end if;
  if jsonb_array_length(coalesce(p_lines, '[]'::jsonb)) = 0 then
    raise exception 'at least one RTV line is required';
  end if;

  select coalesce(max(nullif(regexp_replace(rtv_number, '[^0-9]', '', 'g'), '')::integer), 0) + 1
    into v_number
  from public.return_to_vendor
  where org_id = p_org_id;
  insert into public.return_to_vendor(id, org_id, rtv_number, supplier_name, status, created_by, updated_by)
  values (v_id, p_org_id, 'RTV' || v_number, btrim(p_supplier_name), 'PENDING', auth.uid(), auth.uid());

  for v_line in
    select *
    from jsonb_to_recordset(p_lines) as x(
      purchase_order_id uuid,
      product_id uuid,
      location_id uuid,
      quantity integer,
      reason text,
      serial_numbers jsonb
    )
  loop
    if v_line.purchase_order_id is null or v_line.product_id is null
      or v_line.location_id is null or v_line.quantity is null or v_line.quantity <= 0
      or nullif(btrim(v_line.reason), '') is null then
      raise exception 'invalid RTV line';
    end if;
    select p.is_serialized into v_is_serialized
    from public.products p
    where p.id = v_line.product_id and p.org_id = p_org_id;
    if v_is_serialized is null then
      raise exception 'RTV SKU is not available in the active organization';
    end if;
    if not exists (
      select 1
      from public.inventory_balances b
      join public.locations l on l.id = b.location_id
      join public.warehouse_zones z on z.id = l.zone_id
      join public.purchase_order_items poi
        on poi.purchase_order_id = v_line.purchase_order_id
        and poi.product_id = b.product_id
        and poi.location_id = b.location_id
      join public.purchase_orders po on po.id = poi.purchase_order_id
      where b.product_id = v_line.product_id
        and b.location_id = v_line.location_id
        and z.zone_type = 'STORAGE'
        and b.quantity_on_hand - b.quantity_reserved >= v_line.quantity
        and poi.quantity_received > 0
        and po.org_id = p_org_id
        and po.status in ('RECEIVED', 'PARTIALLY_RECEIVED', 'COMPLETED')
    ) then
      raise exception 'RTV requires accepted PO stock currently in a putaway bin';
    end if;

    if v_is_serialized then
      if jsonb_typeof(coalesce(v_line.serial_numbers, '[]'::jsonb)) <> 'array' then
        raise exception 'serialized RTV SKU requires scanned serial numbers';
      end if;
      select count(*), count(distinct lower(btrim(value)))
        into v_serial_count, v_distinct_serial_count
      from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      where btrim(value) <> '';
      if v_serial_count <> v_line.quantity or v_distinct_serial_count <> v_line.quantity then
        raise exception 'serialized RTV SKU requires exactly % unique scanned serial numbers', v_line.quantity;
      end if;

      perform 1
      from public.serial_numbers sn
      join (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested on requested.serial_number = lower(sn.serial_number)
      where sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.location_id = v_line.location_id
        and sn.purchase_order_id = v_line.purchase_order_id
        and sn.status = 'IN_STOCK'
        and not exists (
          select 1
          from public.rtv_serial_numbers existing
          join public.return_to_vendor existing_rtv on existing_rtv.id = existing.rtv_id
          where existing.serial_id = sn.id and existing_rtv.status = 'PENDING'
        )
      for update of sn;

      select count(*) into v_matching_serial_count
      from public.serial_numbers sn
      join (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested on requested.serial_number = lower(sn.serial_number)
      where sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.location_id = v_line.location_id
        and sn.purchase_order_id = v_line.purchase_order_id
        and sn.status = 'IN_STOCK'
        and not exists (
          select 1
          from public.rtv_serial_numbers existing
          join public.return_to_vendor existing_rtv on existing_rtv.id = existing.rtv_id
          where existing.serial_id = sn.id and existing_rtv.status = 'PENDING'
        );
      if v_matching_serial_count <> v_line.quantity then
        raise exception 'one or more scanned serial numbers are not available from the selected PO putaway bin';
      end if;
    elsif v_line.serial_numbers is not null then
      if jsonb_typeof(v_line.serial_numbers) <> 'array' then
        raise exception 'serial numbers must be supplied as a list';
      end if;
      if jsonb_array_length(v_line.serial_numbers) <> 0 then
        raise exception 'serial numbers were provided for a non-serialized RTV SKU';
      end if;
    end if;

    insert into public.return_to_vendor_items(rtv_id, purchase_order_id, product_id, location_id, quantity, reason)
    values (v_id, v_line.purchase_order_id, v_line.product_id, v_line.location_id, v_line.quantity, btrim(v_line.reason))
    returning id into v_rtv_item_id;

    if v_is_serialized then
      insert into public.rtv_serial_numbers(rtv_id, rtv_item_id, serial_id, serial_number, created_by)
      select v_id, v_rtv_item_id, sn.id, sn.serial_number, auth.uid()
      from public.serial_numbers sn
      join (
        select distinct lower(btrim(value)) as serial_number
        from jsonb_array_elements_text(v_line.serial_numbers) as s(value)
      ) requested on requested.serial_number = lower(sn.serial_number)
      where sn.org_id = p_org_id
        and sn.product_id = v_line.product_id
        and sn.location_id = v_line.location_id
        and sn.purchase_order_id = v_line.purchase_order_id
        and sn.status = 'IN_STOCK';

      update public.serial_numbers sn
      set status = 'RTV_PENDING',
          rtv_id = v_id,
          updated_by = auth.uid()
      from public.rtv_serial_numbers rs
      where rs.rtv_item_id = v_rtv_item_id
        and rs.serial_id = sn.id;

      -- Hold the same quantity in the balance so a Sales Order cannot reserve
      -- these exact serials while this RTV is waiting for dispatch.
      update public.inventory_balances
      set quantity_reserved = quantity_reserved + v_line.quantity,
          updated_at = now()
      where product_id = v_line.product_id
        and location_id = v_line.location_id
        and lot_number = ''
        and quantity_on_hand - quantity_reserved >= v_line.quantity;
      if not found then
        raise exception 'serialized RTV stock is no longer available to reserve';
      end if;
    end if;
  end loop;

  return v_id;
end;
$$;

create or replace function public.dispatch_return_to_vendor(p_rtv_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rtv public.return_to_vendor%rowtype;
  v_item record;
  v_warehouse_id uuid;
  v_serial_count integer;
  v_has_serials boolean;
begin
  select * into v_rtv from public.return_to_vendor where id = p_rtv_id for update;
  if v_rtv.id is null then raise exception 'RTV not found'; end if;
  if not public.is_org_role(v_rtv.org_id, array['owner', 'manager']) then
    raise exception 'manager or owner access is required';
  end if;
  if v_rtv.status <> 'PENDING' then raise exception 'only pending RTV records can be dispatched'; end if;

  for v_item in select * from public.return_to_vendor_items where rtv_id = v_rtv.id loop
    select exists (select 1 from public.rtv_serial_numbers where rtv_item_id = v_item.id)
      into v_has_serials;
    if v_has_serials then
      perform 1
      from public.serial_numbers sn
      join public.rtv_serial_numbers rs on rs.serial_id = sn.id
      where rs.rtv_item_id = v_item.id
        and sn.status = 'RTV_PENDING'
        and sn.rtv_id = v_rtv.id
      for update of sn;
      select count(*) into v_serial_count
      from public.serial_numbers sn
      join public.rtv_serial_numbers rs on rs.serial_id = sn.id
      where rs.rtv_item_id = v_item.id
        and sn.status = 'RTV_PENDING'
        and sn.rtv_id = v_rtv.id;
      if v_serial_count <> v_item.quantity then
        raise exception 'one or more RTV serial numbers are no longer available to dispatch';
      end if;
    end if;

    if v_has_serials then
      update public.inventory_balances
      set quantity_on_hand = quantity_on_hand - v_item.quantity,
          quantity_reserved = quantity_reserved - v_item.quantity,
          updated_at = now()
      where product_id = v_item.product_id
        and location_id = v_item.location_id
        and lot_number = ''
        and quantity_reserved >= v_item.quantity
        and quantity_on_hand >= quantity_reserved;
    else
      update public.inventory_balances
      set quantity_on_hand = quantity_on_hand - v_item.quantity,
          updated_at = now()
      where product_id = v_item.product_id
        and location_id = v_item.location_id
        and lot_number = ''
        and quantity_on_hand - quantity_reserved >= v_item.quantity;
    end if;
    if not found then raise exception 'insufficient accepted putaway stock for RTV dispatch'; end if;

    update public.serial_numbers sn
    set status = 'VOIDED',
        rtv_id = v_rtv.id,
        vendor_returned_at = now(),
        updated_by = auth.uid()
    from public.rtv_serial_numbers rs
    where rs.rtv_item_id = v_item.id
      and rs.serial_id = sn.id;

    select z.warehouse_id into v_warehouse_id
    from public.locations l
    join public.warehouse_zones z on z.id = l.zone_id
    where l.id = v_item.location_id;
    insert into public.inventory_transactions(org_id, warehouse_id, product_id, location_id, transaction_type, quantity_delta, reference_type, reference_id, reason, user_id)
    values (v_rtv.org_id, v_warehouse_id, v_item.product_id, v_item.location_id, 'OUTBOUND', -v_item.quantity, 'RETURN_TO_VENDOR', v_rtv.id, v_item.reason, auth.uid());
  end loop;

  update public.return_to_vendor
  set status = 'SHIPPED', updated_by = auth.uid()
  where id = v_rtv.id;
end;
$$;
