-- ============================================================================
-- ProConnect WMS — Database Schema
-- Run this once in the Supabase SQL editor (or via `supabase db push`) on a
-- fresh project. Safe to re-run: guarded with IF NOT EXISTS / DROP POLICY IF
-- EXISTS where practical.
-- ============================================================================

create extension if not exists "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. Tenancy: organizations + membership
--    Every org-scoped table below carries org_id and is protected by RLS
--    keyed off org_members. This is what lets one codebase serve both the
--    managed multi-tenant deployment and a single-tenant client-managed one
--    (client-managed just has exactly one row in `organizations`).
-- ----------------------------------------------------------------------------

create table if not exists organizations (
    id uuid primary key default uuid_generate_v4(),
    name varchar(150) not null,
    slug varchar(150) unique not null,
    deployment_mode varchar(20) not null default 'managed', -- 'managed' | 'client_managed'
    created_at timestamptz not null default now()
);

alter table organizations add column if not exists code varchar(20);
update organizations
  set code = upper(left(regexp_replace(slug, '[^a-zA-Z0-9]', '', 'g'), 20))
  where code is null or code = '';

create table if not exists org_members (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    user_id uuid not null references auth.users(id) on delete cascade,
    role varchar(20) not null default 'operator', -- 'owner' | 'manager' | 'operator'
    created_at timestamptz not null default now(),
    unique(org_id, user_id)
);

-- Platform administrators can manage every organization. Keep this separate
-- from org_members: an organization owner is not automatically a platform admin.
create table if not exists platform_admins (
    user_id uuid primary key references auth.users(id) on delete cascade,
    created_at timestamptz not null default now()
);

-- Helper: is the current JWT's user a member of this org?
create or replace function is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from org_members
    where org_id = check_org_id and user_id = auth.uid()
  );
$$;

-- Role helper used by the user-management policies below. Security definer
-- avoids a recursive RLS lookup on org_members.
create or replace function is_org_owner(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role = 'owner'
  );
$$;

create or replace function is_org_role(check_org_id uuid, allowed_roles text[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.org_members
    where org_id = check_org_id
      and user_id = auth.uid()
      and role = any(allowed_roles)
  );
$$;

-- ----------------------------------------------------------------------------
-- 2. Warehouses & spatial hierarchy
-- ----------------------------------------------------------------------------

create table if not exists warehouses (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    code varchar(20) not null,
    name varchar(100) not null,
    address text,
    created_at timestamptz not null default now(),
    unique(org_id, code)
);

create table if not exists warehouse_zones (
    id uuid primary key default uuid_generate_v4(),
    warehouse_id uuid not null references warehouses(id) on delete cascade,
    zone_code varchar(20) not null,
    zone_type varchar(20) not null default 'STORAGE', -- RECEIVING, PICKING, STORAGE, DISPATCH
    unique(warehouse_id, zone_code)
);

create table if not exists locations (
    id uuid primary key default uuid_generate_v4(),
    zone_id uuid not null references warehouse_zones(id) on delete cascade,
    location_code varchar(50) not null,
    aisle varchar(10),
    rack varchar(10),
    shelf varchar(10),
    bin varchar(10),
    is_active boolean not null default true,
    unique(zone_id, location_code)
);

-- ----------------------------------------------------------------------------
-- 3. Master SKU & inventory
-- ----------------------------------------------------------------------------

create table if not exists products (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    sku varchar(50) not null,
    barcode varchar(100) not null,
    name varchar(255) not null,
    description text,
    unit_of_measure varchar(20) not null default 'PCS',
    created_at timestamptz not null default now(),
    unique(org_id, sku),
    unique(org_id, barcode)
);

create table if not exists inventory_balances (
    id uuid primary key default uuid_generate_v4(),
    product_id uuid not null references products(id) on delete cascade,
    location_id uuid not null references locations(id) on delete cascade,
    lot_number varchar(50) default '',
    quantity_on_hand integer not null default 0,
    quantity_reserved integer not null default 0,
    expiry_date date,
    updated_at timestamptz not null default now(),
    constraint chk_qty check (quantity_on_hand >= 0),
    unique(product_id, location_id, lot_number)
);

-- ----------------------------------------------------------------------------
-- 4. Orders
-- ----------------------------------------------------------------------------

create table if not exists purchase_orders (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    po_number varchar(50) not null,
    supplier_name varchar(100),
    status varchar(30) not null default 'PENDING', -- PENDING, RECEIVING, COMPLETED
    created_at timestamptz not null default now(),
    unique(org_id, po_number)
);

create table if not exists purchase_order_items (
    id uuid primary key default uuid_generate_v4(),
    purchase_order_id uuid not null references purchase_orders(id) on delete cascade,
    product_id uuid not null references products(id),
    location_id uuid not null references locations(id),
    quantity_expected integer not null check (quantity_expected > 0),
    quantity_received integer not null default 0 check (quantity_received >= 0)
);

-- Immutable business audit trail. Inventory balances are the current state;
-- this table explains every change to that state.
create table if not exists inventory_transactions (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    warehouse_id uuid references warehouses(id),
    product_id uuid not null references products(id),
    location_id uuid not null references locations(id),
    transaction_type varchar(20) not null check (transaction_type in ('INBOUND','OUTBOUND','ADJUSTMENT')),
    quantity_delta integer not null check (quantity_delta <> 0),
    reference_type varchar(30),
    reference_id uuid,
    reason text,
    user_id uuid references auth.users(id),
    created_at timestamptz not null default now()
);

create or replace function receive_purchase_order(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_po public.purchase_orders%rowtype;
  v_item record;
  v_warehouse_id uuid;
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status = 'COMPLETED' then raise exception 'purchase order already received'; end if;
  for v_item in select poi.*, z.warehouse_id from public.purchase_order_items poi join public.locations l on l.id = poi.location_id join public.warehouse_zones z on z.id = l.zone_id where poi.purchase_order_id = p_purchase_order_id loop
    insert into public.inventory_balances (product_id, location_id, lot_number, quantity_on_hand)
      values (v_item.product_id, v_item.location_id, '', v_item.quantity_expected)
      on conflict (product_id, location_id, lot_number) do update set quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand, updated_at = now();
    update public.purchase_order_items set quantity_received = quantity_expected where id = v_item.id;
    insert into public.inventory_transactions (org_id, warehouse_id, product_id, location_id, transaction_type, quantity_delta, reference_type, reference_id, reason, user_id)
      values (v_po.org_id, v_item.warehouse_id, v_item.product_id, v_item.location_id, 'INBOUND', v_item.quantity_expected, 'PURCHASE_ORDER', v_po.id, 'PO receipt', auth.uid());
  end loop;
  update public.purchase_orders set status = 'COMPLETED' where id = p_purchase_order_id;
end;
$$;

create or replace function apply_stock_adjustment(p_org_id uuid, p_product_id uuid, p_location_id uuid, p_quantity_delta integer, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare v_warehouse_id uuid;
begin
  if p_quantity_delta = 0 then raise exception 'adjustment quantity cannot be zero'; end if;
  if not public.is_org_role(p_org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=p_location_id;
  if v_warehouse_id is null then raise exception 'location not found'; end if;
  insert into public.inventory_balances (product_id, location_id, lot_number, quantity_on_hand)
    values (p_product_id, p_location_id, '', p_quantity_delta)
    on conflict (product_id, location_id, lot_number) do update set quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand, updated_at=now();
  insert into public.inventory_transactions (org_id, warehouse_id, product_id, location_id, transaction_type, quantity_delta, reason, user_id)
    values (p_org_id, v_warehouse_id, p_product_id, p_location_id, 'ADJUSTMENT', p_quantity_delta, p_reason, auth.uid());
end;
$$;

create table if not exists sales_orders (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    order_number varchar(50) not null,
    platform varchar(50) not null default 'MANUAL', -- SHOPEE, LAZADA, TIKTOK, DIRECT, MANUAL
    customer_name varchar(100),
    shipping_address text,
    shipping_city varchar(100),
    shipping_postcode varchar(20),
    status varchar(30) not null default 'NEW', -- NEW, ALLOCATED, PICKING, PACKED, SHIPPED
    created_at timestamptz not null default now(),
    unique(org_id, order_number)
);

alter table sales_orders add column if not exists shipping_address text;
alter table sales_orders add column if not exists shipping_city varchar(100);
alter table sales_orders add column if not exists shipping_postcode varchar(20);

create table if not exists sales_order_sequences (
    org_id uuid primary key references organizations(id) on delete cascade,
    last_value integer not null default 0,
    constraint sales_order_sequences_nonnegative check (last_value >= 0)
);

-- Creates the header and assigns a sequence atomically, so concurrent users
-- can never receive the same organization-specific order number.
create or replace function create_sales_order(
    p_org_id uuid,
    p_customer_name varchar,
    p_platform varchar default 'MANUAL',
    p_shipping_address text default null,
    p_shipping_city varchar default null,
    p_shipping_postcode varchar default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence integer;
  v_org_code varchar;
  v_order_id uuid;
begin
  if not public.is_org_role(p_org_id, array['owner', 'manager']) then
    raise exception 'manager or owner access is required to create orders';
  end if;

  select coalesce(nullif(code, ''), upper(left(regexp_replace(slug, '[^a-zA-Z0-9]', '', 'g'), 20)))
    into v_org_code
    from public.organizations where id = p_org_id;
  if v_org_code is null then raise exception 'organization not found'; end if;

  insert into public.sales_order_sequences (org_id, last_value)
    values (p_org_id, 1)
    on conflict (org_id) do update set last_value = public.sales_order_sequences.last_value + 1
    returning last_value into v_sequence;

  insert into public.sales_orders (org_id, order_number, platform, customer_name, shipping_address, shipping_city, shipping_postcode, status)
    values (p_org_id, v_org_code || '-SO-' || lpad(v_sequence::text, 5, '0'), coalesce(p_platform, 'MANUAL'), p_customer_name, p_shipping_address, p_shipping_city, p_shipping_postcode, 'NEW')
    returning id into v_order_id;
  return v_order_id;
end;
$$;

create table if not exists order_items (
    id uuid primary key default uuid_generate_v4(),
    sales_order_id uuid not null references sales_orders(id) on delete cascade,
    product_id uuid not null references products(id),
    quantity_requested integer not null,
    quantity_picked integer not null default 0
);

-- ----------------------------------------------------------------------------
-- 5. Scan events (audit trail for every PDA / browser-scan action)
-- ----------------------------------------------------------------------------

create table if not exists scan_events (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    warehouse_id uuid not null references warehouses(id),
    user_id uuid not null references auth.users(id),
    event_type varchar(20) not null, -- PUTAWAY, PICK, CYCLE_COUNT
    product_id uuid references products(id),
    location_id uuid references locations(id),
    quantity integer not null default 0,
    created_at timestamptz not null default now()
);

-- Atomically apply a scan (put-away adds stock, pick removes it) and log it.
-- Called from the /scan screen via supabase.rpc('apply_scan_event', ...).
create or replace function apply_scan_event(
    p_org_id uuid,
    p_warehouse_id uuid,
    p_event_type varchar,
    p_product_id uuid,
    p_location_id uuid,
    p_quantity integer,
    p_lot_number varchar default ''
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance_id uuid;
begin
  if not public.is_org_member(p_org_id) then
    raise exception 'not a member of this organization';
  end if;

  if p_event_type not in ('PUTAWAY', 'PICK', 'CYCLE_COUNT') then
    raise exception 'invalid scan event type';
  end if;

  if p_quantity <= 0 then
    raise exception 'scan quantity must be greater than zero';
  end if;

  if not exists (
    select 1 from public.warehouses
    where id = p_warehouse_id and org_id = p_org_id
  ) then
    raise exception 'warehouse does not belong to this organization';
  end if;

  if not exists (
    select 1 from public.products
    where id = p_product_id and org_id = p_org_id
  ) then
    raise exception 'product does not belong to this organization';
  end if;

  if not exists (
    select 1
    from public.locations l
    join public.warehouse_zones z on z.id = l.zone_id
    where l.id = p_location_id
      and z.warehouse_id = p_warehouse_id
      and l.is_active
  ) then
    raise exception 'location does not belong to this warehouse or is inactive';
  end if;

  if p_event_type = 'PUTAWAY' then
    insert into public.inventory_balances (product_id, location_id, lot_number, quantity_on_hand)
    values (p_product_id, p_location_id, coalesce(p_lot_number, ''), p_quantity)
    on conflict (product_id, location_id, lot_number)
    do update set quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand,
                  updated_at = now();
  elsif p_event_type = 'PICK' then
    update public.inventory_balances
      set quantity_on_hand = quantity_on_hand - p_quantity,
          updated_at = now()
      where product_id = p_product_id
        and location_id = p_location_id
        and lot_number = coalesce(p_lot_number, '')
        and quantity_on_hand >= p_quantity
      returning id into v_balance_id;

    if v_balance_id is null then
      raise exception 'insufficient stock at this location';
    end if;
  end if;

  insert into public.scan_events (org_id, warehouse_id, user_id, event_type, product_id, location_id, quantity)
  values (p_org_id, p_warehouse_id, auth.uid(), p_event_type, p_product_id, p_location_id, p_quantity);

  if p_event_type in ('PUTAWAY', 'PICK') then
    insert into public.inventory_transactions (org_id, warehouse_id, product_id, location_id, transaction_type, quantity_delta, reference_type, reason, user_id)
    values (
      p_org_id,
      p_warehouse_id,
      p_product_id,
      p_location_id,
      case when p_event_type = 'PICK' then 'OUTBOUND' else 'INBOUND' end,
      case when p_event_type = 'PICK' then -p_quantity else p_quantity end,
      'SCAN',
      p_event_type,
      auth.uid()
    );
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Row Level Security — every org-scoped table is locked to org members
-- ----------------------------------------------------------------------------

alter table organizations enable row level security;
alter table org_members enable row level security;
alter table platform_admins enable row level security;
alter table warehouses enable row level security;
alter table warehouse_zones enable row level security;
alter table locations enable row level security;
alter table products enable row level security;
alter table inventory_balances enable row level security;
alter table purchase_orders enable row level security;
alter table sales_orders enable row level security;
alter table order_items enable row level security;
alter table scan_events enable row level security;
alter table sales_order_sequences enable row level security;
alter table purchase_order_items enable row level security;
alter table inventory_transactions enable row level security;

drop policy if exists org_members_select on organizations;
create policy org_members_select on organizations for select
  using (is_org_member(id));

drop policy if exists org_members_self on org_members;
drop policy if exists org_members_select on org_members;
drop policy if exists org_members_owner_insert on org_members;
drop policy if exists org_members_owner_update on org_members;
drop policy if exists org_members_owner_delete on org_members;
create policy org_members_select on org_members for select
  using (is_org_member(org_id));

create policy org_members_owner_insert on org_members for insert
  with check (public.is_org_owner(org_id));

create policy org_members_owner_update on org_members for update
  using (public.is_org_owner(org_id))
  with check (public.is_org_owner(org_id));

create policy org_members_owner_delete on org_members for delete
  using (public.is_org_owner(org_id));

drop policy if exists platform_admins_self on platform_admins;
create policy platform_admins_self on platform_admins for select
  using (user_id = auth.uid());

drop policy if exists warehouses_scoped on warehouses;
drop policy if exists warehouses_read on warehouses;
drop policy if exists warehouses_manage on warehouses;
create policy warehouses_read on warehouses for select using (is_org_member(org_id));
create policy warehouses_manage on warehouses for all using (public.is_org_role(org_id, array['owner','manager'])) with check (public.is_org_role(org_id, array['owner','manager']));

drop policy if exists zones_scoped on warehouse_zones;
drop policy if exists zones_read on warehouse_zones;
drop policy if exists zones_manage on warehouse_zones;
create policy zones_read on warehouse_zones for select using (is_org_member((select org_id from warehouses w where w.id = warehouse_id)));
create policy zones_manage on warehouse_zones for all using (public.is_org_role((select org_id from warehouses w where w.id = warehouse_id), array['owner','manager'])) with check (public.is_org_role((select org_id from warehouses w where w.id = warehouse_id), array['owner','manager']));

drop policy if exists locations_scoped on locations;
drop policy if exists locations_read on locations;
drop policy if exists locations_manage on locations;
create policy locations_read on locations for select using (is_org_member((select org_id from warehouses w join warehouse_zones z on z.warehouse_id = w.id where z.id = zone_id)));
create policy locations_manage on locations for all using (public.is_org_role((select w.org_id from warehouses w join warehouse_zones z on z.warehouse_id = w.id where z.id = zone_id), array['owner','manager'])) with check (public.is_org_role((select w.org_id from warehouses w join warehouse_zones z on z.warehouse_id = w.id where z.id = zone_id), array['owner','manager']));

drop policy if exists products_scoped on products;
drop policy if exists products_read on products;
drop policy if exists products_manage on products;
create policy products_read on products for select using (is_org_member(org_id));
create policy products_manage on products for all using (public.is_org_role(org_id, array['owner','manager'])) with check (public.is_org_role(org_id, array['owner','manager']));

drop policy if exists inventory_scoped on inventory_balances;
drop policy if exists inventory_read on inventory_balances;
drop policy if exists inventory_manage on inventory_balances;
create policy inventory_read on inventory_balances for select using (is_org_member((select p.org_id from products p where p.id = product_id)));
create policy inventory_manage on inventory_balances for all using (public.is_org_role((select p.org_id from products p where p.id = product_id), array['owner','manager'])) with check (public.is_org_role((select p.org_id from products p where p.id = product_id), array['owner','manager']));

drop policy if exists po_scoped on purchase_orders;
create policy po_scoped on purchase_orders for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

drop policy if exists purchase_order_items_scoped on purchase_order_items;
create policy purchase_order_items_scoped on purchase_order_items for all
  using (is_org_member((select po.org_id from public.purchase_orders po where po.id = purchase_order_id)))
  with check (public.is_org_role((select po.org_id from public.purchase_orders po where po.id = purchase_order_id), array['owner','manager']));

drop policy if exists inventory_transactions_read on inventory_transactions;
create policy inventory_transactions_read on inventory_transactions for select
  using (is_org_member(org_id));

drop policy if exists so_scoped on sales_orders;
drop policy if exists sales_orders_read on sales_orders;
drop policy if exists sales_orders_manage on sales_orders;
create policy sales_orders_read on sales_orders for select using (is_org_member(org_id));
create policy sales_orders_manage on sales_orders for all using (public.is_org_role(org_id, array['owner','manager'])) with check (public.is_org_role(org_id, array['owner','manager']));

drop policy if exists order_items_scoped on order_items;
create policy order_items_scoped on order_items for all
  using (is_org_member((select so.org_id from sales_orders so where so.id = sales_order_id)))
  with check (is_org_member((select so.org_id from sales_orders so where so.id = sales_order_id)));

drop policy if exists scan_events_scoped on scan_events;
create policy scan_events_scoped on scan_events for all
  using (is_org_member(org_id)) with check (is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- 7. Indexes for the lookups the app makes constantly
-- ----------------------------------------------------------------------------

create index if not exists idx_products_org on products(org_id);
create index if not exists idx_products_barcode on products(org_id, barcode);
create index if not exists idx_inventory_product on inventory_balances(product_id);
create index if not exists idx_inventory_location on inventory_balances(location_id);
create index if not exists idx_sales_orders_org_status on sales_orders(org_id, status);
create index if not exists idx_scan_events_org_created on scan_events(org_id, created_at desc);
create index if not exists idx_inventory_transactions_org_created on inventory_transactions(org_id, created_at desc);
