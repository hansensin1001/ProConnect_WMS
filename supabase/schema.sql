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
create table if not exists identifier_sequences (
    entity varchar(40) primary key,
    last_value integer not null default 0 check (last_value >= 0)
);

-- Convert any existing tenant labels once, then keep every future identifier
-- short and sequential. UUIDs remain the relational keys and are never shown.
with ranked as (
  select id, row_number() over (order by created_at, id) as sequence from organizations
)
update organizations o set code = 'ORG' || ranked.sequence from ranked where ranked.id = o.id and (o.code is null or o.code !~ '^ORG[0-9]+$');
insert into identifier_sequences(entity, last_value)
values ('organization', (select count(*) from organizations))
on conflict (entity) do update set last_value = greatest(identifier_sequences.last_value, excluded.last_value);
create unique index if not exists organizations_code_key on organizations(code);

create or replace function assign_organization_code()
returns trigger language plpgsql set search_path = public as $$
declare v_sequence integer;
begin
  if new.code is null or new.code !~ '^ORG[0-9]+$' then
    insert into public.identifier_sequences(entity, last_value) values ('organization', 1)
    on conflict (entity) do update set last_value = public.identifier_sequences.last_value + 1
    returning last_value into v_sequence;
    new.code := 'ORG' || v_sequence;
  end if;
  return new;
end;
$$;
drop trigger if exists organizations_assign_code on organizations;
create trigger organizations_assign_code before insert on organizations
for each row execute function assign_organization_code();

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

create table if not exists user_profiles (
    user_id uuid primary key references auth.users(id) on delete cascade,
    user_code varchar(20) not null unique,
    display_name varchar(150),
    email varchar(254),
    is_disabled boolean not null default false,
    created_at timestamptz not null default now()
);

alter table user_profiles add column if not exists email varchar(254);
alter table user_profiles add column if not exists is_disabled boolean not null default false;
update user_profiles profile set email = users.email from auth.users users where users.id = profile.user_id and profile.email is null;

with ranked as (
  select id, row_number() over (order by created_at, id) as sequence from auth.users
)
insert into user_profiles(user_id, user_code)
select id, 'USR' || sequence from ranked
on conflict (user_id) do nothing;
insert into identifier_sequences(entity, last_value)
values ('user', (select count(*) from user_profiles))
on conflict (entity) do update set last_value = greatest(identifier_sequences.last_value, excluded.last_value);

create or replace function create_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sequence integer;
begin
  insert into public.identifier_sequences(entity, last_value) values ('user', 1)
  on conflict (entity) do update set last_value = public.identifier_sequences.last_value + 1
  returning last_value into v_sequence;
  insert into public.user_profiles(user_id, user_code, display_name, email)
  values (new.id, 'USR' || v_sequence, coalesce(new.raw_user_meta_data->>'name', new.email), new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;
drop trigger if exists auth_users_create_profile on auth.users;
create trigger auth_users_create_profile after insert on auth.users
for each row execute function public.create_user_profile();

-- Helper: is the current JWT's user a member of this org?
create or replace function is_org_member(check_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
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

alter table locations add column if not exists display_code varchar(20);
with ranked as (
  select id, row_number() over (order by location_code, id) as sequence from locations
)
update locations l set display_code = 'LOC' || ranked.sequence from ranked where ranked.id = l.id and (l.display_code is null or l.display_code !~ '^LOC[0-9]+$');
insert into identifier_sequences(entity, last_value)
values ('location', (select count(*) from locations))
on conflict (entity) do update set last_value = greatest(identifier_sequences.last_value, excluded.last_value);
create unique index if not exists locations_display_code_key on locations(display_code);

create or replace function assign_location_display_code()
returns trigger language plpgsql set search_path = public as $$
declare v_sequence integer;
begin
  if new.display_code is null or new.display_code !~ '^LOC[0-9]+$' then
    insert into public.identifier_sequences(entity, last_value) values ('location', 1)
    on conflict (entity) do update set last_value = public.identifier_sequences.last_value + 1
    returning last_value into v_sequence;
    new.display_code := 'LOC' || v_sequence;
  end if;
  return new;
end;
$$;
drop trigger if exists locations_assign_display_code on locations;
create trigger locations_assign_display_code before insert on locations
for each row execute function assign_location_display_code();

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

-- SKU is the application-visible product identifier. Existing catalog rows
-- are renumbered deterministically and new rows receive SKU# automatically.
update products set sku = '__SKU__' || id::text where exists (select 1 from products where sku !~ '^SKU[0-9]+$');
with ranked as (
  select id, row_number() over (order by created_at, id) as sequence from products
)
update products p set sku = 'SKU' || ranked.sequence from ranked where ranked.id = p.id and p.sku like '__SKU__%';
insert into identifier_sequences(entity, last_value)
values ('sku', (select count(*) from products))
on conflict (entity) do update set last_value = greatest(identifier_sequences.last_value, excluded.last_value);

create or replace function assign_product_sku()
returns trigger language plpgsql set search_path = public as $$
declare v_sequence integer;
begin
  if new.sku is null or new.sku !~ '^SKU[0-9]+$' then
    insert into public.identifier_sequences(entity, last_value) values ('sku', 1)
    on conflict (entity) do update set last_value = public.identifier_sequences.last_value + 1
    returning last_value into v_sequence;
    new.sku := 'SKU' || v_sequence;
  end if;
  return new;
end;
$$;
drop trigger if exists products_assign_sku on products;
create trigger products_assign_sku before insert on products
for each row execute function assign_product_sku();

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

-- These tables deliberately appear before the workflow functions below.  A
-- previous schema ordering created allocation tables before `order_items`,
-- which made a clean-project migration fail before any application code ran.
create table if not exists sales_orders (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null references organizations(id) on delete cascade,
    order_number varchar(50) not null,
    platform varchar(50) not null default 'MANUAL',
    customer_name varchar(100),
    shipping_address text,
    shipping_city varchar(100),
    shipping_postcode varchar(20),
    status varchar(30) not null default 'NEW',
    created_at timestamptz not null default now(),
    unique(org_id, order_number)
);

create table if not exists sales_order_sequences (
    org_id uuid primary key references organizations(id) on delete cascade,
    last_value integer not null default 0,
    constraint sales_order_sequences_nonnegative check (last_value >= 0)
);

update sales_orders set order_number = '__SO__' || id::text where exists (select 1 from sales_orders where order_number !~ '^ORG[0-9]+-SO[0-9]+$');
with ranked as (
  select id, org_id, row_number() over (partition by org_id order by created_at, id) as sequence from sales_orders
)
update sales_orders so set order_number = o.code || '-SO' || ranked.sequence
from ranked join organizations o on o.id = ranked.org_id where ranked.id = so.id and so.order_number like '__SO__%';
insert into sales_order_sequences(org_id, last_value)
select org_id, count(*)::integer from sales_orders group by org_id
on conflict (org_id) do update set last_value = greatest(sales_order_sequences.last_value, excluded.last_value);

create table if not exists order_items (
    id uuid primary key default uuid_generate_v4(),
    sales_order_id uuid not null references sales_orders(id) on delete cascade,
    product_id uuid not null references products(id),
    quantity_requested integer not null check (quantity_requested > 0),
    quantity_picked integer not null default 0 check (quantity_picked >= 0),
    quantity_reserved integer not null default 0 check (quantity_reserved >= 0)
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

create table if not exists purchase_order_sequences (
    org_id uuid primary key references organizations(id) on delete cascade,
    last_value integer not null default 0 check (last_value >= 0)
);

update purchase_orders set po_number = '__PO__' || id::text where exists (select 1 from purchase_orders where po_number !~ '^ORG[0-9]+-PO[0-9]+$');
with ranked as (
  select id, org_id, row_number() over (partition by org_id order by created_at, id) as sequence from purchase_orders
)
update purchase_orders po set po_number = o.code || '-PO' || ranked.sequence
from ranked join organizations o on o.id = ranked.org_id where ranked.id = po.id and po.po_number like '__PO__%';
insert into purchase_order_sequences(org_id, last_value)
select org_id, count(*)::integer from purchase_orders group by org_id
on conflict (org_id) do update set last_value = greatest(purchase_order_sequences.last_value, excluded.last_value);

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

alter table order_items add column if not exists quantity_reserved integer not null default 0;
create table if not exists order_item_allocations (
    id uuid primary key default uuid_generate_v4(),
    order_item_id uuid not null references order_items(id) on delete cascade,
    inventory_balance_id uuid not null references inventory_balances(id),
    quantity_reserved integer not null check (quantity_reserved > 0),
    quantity_fulfilled integer not null default 0 check (quantity_fulfilled >= 0)
);

create or replace function create_purchase_order_with_lines(p_org_id uuid, p_supplier_name varchar, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_sequence integer; v_code varchar; v_po_id uuid; v_line jsonb;
begin
  if not public.is_org_role(p_org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'at least one inbound line is required'; end if;
  select coalesce(nullif(code,''), upper(left(regexp_replace(slug,'[^a-zA-Z0-9]','','g'),20))) into v_code from public.organizations where id=p_org_id;
  insert into public.purchase_order_sequences(org_id,last_value) values(p_org_id,1) on conflict(org_id) do update set last_value=public.purchase_order_sequences.last_value+1 returning last_value into v_sequence;
  insert into public.purchase_orders(org_id,po_number,supplier_name,status) values(p_org_id,v_code||'-PO'||v_sequence,p_supplier_name,'PENDING') returning id into v_po_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'quantity')::integer,0) <= 0 then raise exception 'inbound quantity must be greater than zero'; end if;
    if not exists(select 1 from public.products where id=(v_line->>'productId')::uuid and org_id=p_org_id) then raise exception 'product does not belong to active organization'; end if;
    if not exists(select 1 from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where l.id=(v_line->>'locationId')::uuid and w.org_id=p_org_id and l.is_active) then raise exception 'receiving location is invalid'; end if;
    insert into public.purchase_order_items(purchase_order_id,product_id,location_id,quantity_expected) values(v_po_id,(v_line->>'productId')::uuid,(v_line->>'locationId')::uuid,(v_line->>'quantity')::integer);
  end loop;
  return v_po_id;
end;
$$;

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
  if v_po.status = 'RECEIVED' then raise exception 'purchase order already received'; end if;
  for v_item in select poi.*, z.warehouse_id from public.purchase_order_items poi join public.locations l on l.id = poi.location_id join public.warehouse_zones z on z.id = l.zone_id where poi.purchase_order_id = p_purchase_order_id loop
    insert into public.inventory_balances (product_id, location_id, lot_number, quantity_on_hand)
      values (v_item.product_id, v_item.location_id, '', v_item.quantity_expected)
      on conflict (product_id, location_id, lot_number) do update set quantity_on_hand = public.inventory_balances.quantity_on_hand + excluded.quantity_on_hand, updated_at = now();
    update public.purchase_order_items set quantity_received = quantity_expected where id = v_item.id;
    insert into public.inventory_transactions (org_id, warehouse_id, product_id, location_id, transaction_type, quantity_delta, reference_type, reference_id, reason, user_id)
      values (v_po.org_id, v_item.warehouse_id, v_item.product_id, v_item.location_id, 'INBOUND', v_item.quantity_expected, 'PURCHASE_ORDER', v_po.id, 'PO receipt', auth.uid());
  end loop;
  update public.purchase_orders set status = 'RECEIVED' where id = p_purchase_order_id;
end;
$$;

create or replace function allocate_sales_order(p_sales_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_item record; v_balance record; v_remaining integer; v_available integer;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status <> 'NEW' then raise exception 'only new sales orders can be allocated'; end if;
  for v_item in select * from public.order_items where sales_order_id=p_sales_order_id loop
    select coalesce(sum(quantity_on_hand-quantity_reserved),0) into v_available from public.inventory_balances b join public.products p on p.id=b.product_id where b.product_id=v_item.product_id and p.org_id=v_order.org_id;
    if v_available < v_item.quantity_requested then raise exception 'insufficient available stock for product %', v_item.product_id; end if;
    v_remaining := v_item.quantity_requested;
    for v_balance in select id, quantity_on_hand, quantity_reserved from public.inventory_balances where product_id=v_item.product_id and quantity_on_hand > quantity_reserved order by updated_at, id for update loop
      exit when v_remaining = 0;
      v_available := least(v_remaining, v_balance.quantity_on_hand-v_balance.quantity_reserved);
      update public.inventory_balances set quantity_reserved=quantity_reserved+v_available,updated_at=now() where id=v_balance.id;
      insert into public.order_item_allocations(order_item_id,inventory_balance_id,quantity_reserved) values(v_item.id,v_balance.id,v_available);
      v_remaining := v_remaining-v_available;
    end loop;
    -- The availability check above is only a fast pre-check.  Inventory rows
    -- are locked inside this loop, so a concurrent allocation can consume
    -- stock between the pre-check and the lock.  Never mark a partial reserve
    -- as allocated.
    if v_remaining > 0 then raise exception 'insufficient available stock for product %', v_item.product_id; end if;
    update public.order_items set quantity_reserved=quantity_requested where id=v_item.id;
  end loop;
  update public.sales_orders set status='ALLOCATED' where id=p_sales_order_id;
end;
$$;

create or replace function fulfill_sales_order(p_sales_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_allocation record; v_location_id uuid; v_warehouse_id uuid;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status <> 'ALLOCATED' then raise exception 'only allocated sales orders can be fulfilled'; end if;
  for v_allocation in select a.*, b.product_id, b.location_id from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id join public.order_items oi on oi.id=a.order_item_id where oi.sales_order_id=p_sales_order_id for update loop
    update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_allocation.quantity_reserved,quantity_reserved=quantity_reserved-v_allocation.quantity_reserved,updated_at=now() where id=v_allocation.inventory_balance_id;
    update public.order_item_allocations set quantity_fulfilled=quantity_reserved where id=v_allocation.id;
    update public.order_items set quantity_picked=quantity_picked+v_allocation.quantity_reserved where id=v_allocation.order_item_id;
    select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_allocation.location_id;
    insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_order.org_id,v_warehouse_id,v_allocation.product_id,v_allocation.location_id,'OUTBOUND',-v_allocation.quantity_reserved,'SALES_ORDER',v_order.id,'Sales order fulfillment',auth.uid());
  end loop;
  update public.sales_orders set status='SHIPPED' where id=p_sales_order_id;
end;
$$;

-- A reservation may only be released by an explicit cancellation workflow.
-- Until that workflow exists, deleting an allocated order would otherwise leave
-- reserved stock stranded in its inventory balance.
create or replace function prevent_sales_order_delete_after_allocation()
returns trigger language plpgsql set search_path = public as $$
begin
  if old.status <> 'NEW' then raise exception 'only new sales orders can be deleted'; end if;
  return old;
end;
$$;
drop trigger if exists sales_orders_delete_guard on sales_orders;
create trigger sales_orders_delete_guard before delete on sales_orders
for each row execute function prevent_sales_order_delete_after_allocation();

create or replace function prevent_location_delete_with_inventory()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.inventory_balances where location_id = old.id and (quantity_on_hand <> 0 or quantity_reserved <> 0)) then
    raise exception 'location cannot be deleted while it contains stock';
  end if;
  return old;
end;
$$;
drop trigger if exists locations_delete_guard on locations;
create trigger locations_delete_guard before delete on locations
for each row execute function prevent_location_delete_with_inventory();

create or replace function prevent_product_delete_with_inventory()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists (select 1 from public.inventory_balances where product_id = old.id and (quantity_on_hand <> 0 or quantity_reserved <> 0)) then
    raise exception 'SKU cannot be deleted while it has stock';
  end if;
  return old;
end;
$$;
drop trigger if exists products_delete_guard on products;
create trigger products_delete_guard before delete on products
for each row execute function prevent_product_delete_with_inventory();

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
  if not exists(select 1 from public.products where id=p_product_id and org_id=p_org_id) then raise exception 'product does not belong to active organization'; end if;
  select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where l.id=p_location_id and w.org_id=p_org_id and l.is_active;
  if v_warehouse_id is null then raise exception 'location not found'; end if;
  if p_quantity_delta < 0 and not exists(select 1 from public.inventory_balances where product_id=p_product_id and location_id=p_location_id and lot_number='' and quantity_on_hand + p_quantity_delta >= quantity_reserved) then raise exception 'adjustment would make on-hand stock lower than reserved stock'; end if;
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
    values (p_org_id, v_org_code || '-SO' || v_sequence, coalesce(p_platform, 'MANUAL'), p_customer_name, p_shipping_address, p_shipping_city, p_shipping_postcode, 'NEW')
    returning id into v_order_id;
  return v_order_id;
end;
$$;

-- Keep header and lines in one transaction: a failed line validation rolls
-- back the generated sequence/header rather than leaving an empty order.
create or replace function create_sales_order_with_lines(p_org_id uuid, p_customer_name varchar, p_platform varchar, p_shipping_address text, p_shipping_city varchar, p_shipping_postcode varchar, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_order_id uuid; v_line jsonb;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'at least one sales order line is required'; end if;
  v_order_id := public.create_sales_order(p_org_id,p_customer_name,p_platform,p_shipping_address,p_shipping_city,p_shipping_postcode);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'quantity')::integer,0) <= 0 then raise exception 'sales quantity must be greater than zero'; end if;
    if not exists(select 1 from public.products where id=(v_line->>'productId')::uuid and org_id=p_org_id) then raise exception 'product does not belong to active organization'; end if;
    insert into public.order_items(sales_order_id,product_id,quantity_requested,quantity_picked,quantity_reserved) values(v_order_id,(v_line->>'productId')::uuid,(v_line->>'quantity')::integer,0,0);
  end loop;
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
        and quantity_on_hand - quantity_reserved >= p_quantity
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
alter table user_profiles enable row level security;
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
alter table purchase_order_sequences enable row level security;
alter table purchase_order_items enable row level security;
alter table order_item_allocations enable row level security;
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

drop policy if exists user_profiles_self on user_profiles;
create policy user_profiles_self on user_profiles for select
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

drop policy if exists po_scoped on purchase_orders;
drop policy if exists purchase_orders_read on purchase_orders;
drop policy if exists purchase_orders_manage on purchase_orders;
create policy purchase_orders_read on purchase_orders for select using (is_org_member(org_id));

drop policy if exists purchase_order_items_scoped on purchase_order_items;
drop policy if exists purchase_order_items_read on purchase_order_items;
drop policy if exists purchase_order_items_manage on purchase_order_items;
create policy purchase_order_items_read on purchase_order_items for select
  using (is_org_member((select po.org_id from public.purchase_orders po where po.id = purchase_order_id)));

drop policy if exists inventory_transactions_read on inventory_transactions;
create policy inventory_transactions_read on inventory_transactions for select
  using (is_org_member(org_id));

drop policy if exists so_scoped on sales_orders;
drop policy if exists sales_orders_read on sales_orders;
drop policy if exists sales_orders_manage on sales_orders;
drop policy if exists sales_orders_delete on sales_orders;
create policy sales_orders_read on sales_orders for select using (is_org_member(org_id));
create policy sales_orders_delete on sales_orders for delete using (public.is_org_role(org_id, array['owner','manager']));

drop policy if exists order_items_scoped on order_items;
drop policy if exists order_items_read on order_items;
drop policy if exists order_items_manage on order_items;
create policy order_items_read on order_items for select
  using (is_org_member((select so.org_id from sales_orders so where so.id = sales_order_id)));

drop policy if exists purchase_order_sequences_read on purchase_order_sequences;
create policy purchase_order_sequences_read on purchase_order_sequences for select
  using (is_org_member(org_id));

drop policy if exists order_item_allocations_read on order_item_allocations;
create policy order_item_allocations_read on order_item_allocations for select
  using (is_org_member((select so.org_id from public.order_items oi join public.sales_orders so on so.id = oi.sales_order_id where oi.id = order_item_id)));

drop policy if exists scan_events_scoped on scan_events;
drop policy if exists scan_events_read on scan_events;
create policy scan_events_read on scan_events for select using (is_org_member(org_id));

-- ----------------------------------------------------------------------------
-- 7. Indexes for the lookups the app makes constantly
-- ----------------------------------------------------------------------------

create index if not exists idx_products_org on products(org_id);
create index if not exists idx_products_barcode on products(org_id, barcode);
create index if not exists idx_inventory_product on inventory_balances(product_id);
create index if not exists idx_inventory_location on inventory_balances(location_id);
create index if not exists idx_sales_orders_org_status on sales_orders(org_id, status);
create index if not exists idx_sales_orders_org_created on sales_orders(org_id, created_at desc);
create index if not exists idx_purchase_orders_org_created on purchase_orders(org_id, created_at desc);
create index if not exists idx_order_items_sales_order on order_items(sales_order_id);
create index if not exists idx_purchase_order_items_order on purchase_order_items(purchase_order_id);
create index if not exists idx_locations_zone on locations(zone_id);
create index if not exists idx_org_members_user_org on org_members(user_id, org_id);
create index if not exists idx_scan_events_org_created on scan_events(org_id, created_at desc);
create index if not exists idx_inventory_transactions_org_created on inventory_transactions(org_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 8. Record audit fields, user identifiers, and reversible workflows
-- ----------------------------------------------------------------------------
-- UUIDs are retained in audit columns so an audit remains useful even when a
-- display name changes.  Use user_profiles when rendering a human name.
alter table organizations add column if not exists created_by uuid;
alter table organizations add column if not exists updated_by uuid;
alter table organizations add column if not exists updated_at timestamptz not null default now();
alter table org_members add column if not exists created_by uuid;
alter table org_members add column if not exists updated_by uuid;
alter table org_members add column if not exists updated_at timestamptz not null default now();
alter table platform_admins add column if not exists created_by uuid;
alter table platform_admins add column if not exists updated_by uuid;
alter table platform_admins add column if not exists updated_at timestamptz not null default now();
alter table user_profiles add column if not exists username varchar(50);
alter table user_profiles add column if not exists created_by uuid;
alter table user_profiles add column if not exists updated_by uuid;
alter table user_profiles add column if not exists updated_at timestamptz not null default now();
alter table warehouses add column if not exists created_by uuid;
alter table warehouses add column if not exists updated_by uuid;
alter table warehouses add column if not exists updated_at timestamptz not null default now();
alter table warehouse_zones add column if not exists created_at timestamptz not null default now();
alter table warehouse_zones add column if not exists created_by uuid;
alter table warehouse_zones add column if not exists updated_by uuid;
alter table warehouse_zones add column if not exists updated_at timestamptz not null default now();
alter table locations add column if not exists created_at timestamptz not null default now();
alter table locations add column if not exists created_by uuid;
alter table locations add column if not exists updated_by uuid;
alter table locations add column if not exists updated_at timestamptz not null default now();
alter table products add column if not exists price numeric(14,2) not null default 0 check (price >= 0);
alter table products add column if not exists created_by uuid;
alter table products add column if not exists updated_by uuid;
alter table products add column if not exists updated_at timestamptz not null default now();
alter table inventory_balances add column if not exists created_at timestamptz not null default now();
alter table inventory_balances add column if not exists created_by uuid;
alter table inventory_balances add column if not exists updated_by uuid;
alter table sales_orders add column if not exists created_by uuid;
alter table sales_orders add column if not exists updated_by uuid;
alter table sales_orders add column if not exists updated_at timestamptz not null default now();
alter table purchase_orders add column if not exists created_by uuid;
alter table purchase_orders add column if not exists updated_by uuid;
alter table purchase_orders add column if not exists updated_at timestamptz not null default now();
alter table order_items add column if not exists created_at timestamptz not null default now();
alter table order_items add column if not exists created_by uuid;
alter table order_items add column if not exists updated_by uuid;
alter table order_items add column if not exists updated_at timestamptz not null default now();
alter table purchase_order_items add column if not exists created_at timestamptz not null default now();
alter table purchase_order_items add column if not exists created_by uuid;
alter table purchase_order_items add column if not exists updated_by uuid;
alter table purchase_order_items add column if not exists updated_at timestamptz not null default now();
alter table inventory_transactions add column if not exists updated_by uuid;
alter table inventory_transactions add column if not exists created_by uuid;
alter table inventory_transactions add column if not exists updated_at timestamptz not null default now();
alter table order_item_allocations add column if not exists created_at timestamptz not null default now();
alter table order_item_allocations add column if not exists created_by uuid;
alter table order_item_allocations add column if not exists updated_by uuid;
alter table order_item_allocations add column if not exists updated_at timestamptz not null default now();
alter table scan_events add column if not exists updated_by uuid;
alter table scan_events add column if not exists created_by uuid;
alter table scan_events add column if not exists updated_at timestamptz not null default now();

-- Backfill a usable login ID for pre-existing users. Platform admins can then
-- replace it with a business username in Administration.
update user_profiles set username = lower(user_code) where username is null;
create unique index if not exists user_profiles_username_key on user_profiles(username) where username is not null;
create index if not exists idx_products_org_name on products(org_id, name);

create or replace function public.apply_record_audit()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := coalesce(new.created_at, now());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'organizations','org_members','platform_admins','user_profiles','warehouses',
    'warehouse_zones','locations','products','inventory_balances','sales_orders',
    'purchase_orders','order_items','purchase_order_items','inventory_transactions',
    'order_item_allocations','scan_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I', table_name || '_record_audit', table_name);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.apply_record_audit()', table_name || '_record_audit', table_name);
  end loop;
end;
$$;

-- Update the profile trigger so non-admin-created users receive a unique,
-- immediately usable User ID too. The admin flow can replace this value.
create or replace function create_user_profile()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_sequence integer; v_code varchar;
begin
  insert into public.identifier_sequences(entity, last_value) values ('user', 1)
  on conflict (entity) do update set last_value = public.identifier_sequences.last_value + 1
  returning last_value into v_sequence;
  v_code := 'USR' || v_sequence;
  insert into public.user_profiles(user_id, user_code, username, display_name, email)
  values (new.id, v_code, lower(v_code), coalesce(new.raw_user_meta_data->>'name', new.email), new.email)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create or replace function update_sales_order_with_lines(
  p_sales_order_id uuid, p_customer_name varchar, p_platform varchar,
  p_shipping_address text, p_shipping_city varchar, p_shipping_postcode varchar,
  p_lines jsonb
) returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_line jsonb;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('DRAFT','NEW') then raise exception 'only draft or new sales orders can be edited'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'at least one sales order line is required'; end if;
  delete from public.order_items where sales_order_id = p_sales_order_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'quantity')::integer, 0) <= 0 then raise exception 'sales quantity must be greater than zero'; end if;
    if not exists (select 1 from public.products where id=(v_line->>'productId')::uuid and org_id=v_order.org_id) then raise exception 'product does not belong to active organization'; end if;
    insert into public.order_items(sales_order_id, product_id, quantity_requested) values (p_sales_order_id, (v_line->>'productId')::uuid, (v_line->>'quantity')::integer);
  end loop;
  update public.sales_orders set customer_name=p_customer_name, platform=coalesce(nullif(p_platform,''),'MANUAL'), shipping_address=nullif(p_shipping_address,''), shipping_city=nullif(p_shipping_city,''), shipping_postcode=nullif(p_shipping_postcode,'') where id=p_sales_order_id;
end;
$$;

create or replace function rollback_sales_order(p_sales_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_item record; v_allocation record; v_warehouse_id uuid; v_remaining integer; v_return_quantity integer;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('ALLOCATED','SHIPPED') then raise exception 'only allocated or shipped sales orders can be rolled back'; end if;
  -- Allocation rows are implementation detail. The order line is the source
  -- of truth: never return more than that line actually picked/reserved.
  for v_item in select * from public.order_items where sales_order_id=p_sales_order_id for update loop
    v_remaining := least(v_item.quantity_requested, case when v_order.status='SHIPPED' then v_item.quantity_picked else v_item.quantity_reserved end);
    for v_allocation in select a.*, b.product_id, b.location_id from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id where a.order_item_id=v_item.id order by a.id for update loop
      exit when v_remaining <= 0;
      v_return_quantity := least(v_remaining, case when v_order.status='SHIPPED' then v_allocation.quantity_fulfilled else v_allocation.quantity_reserved end);
      if v_return_quantity <= 0 then continue; end if;
      if v_order.status = 'SHIPPED' then
        update public.inventory_balances set quantity_on_hand=quantity_on_hand+v_return_quantity where id=v_allocation.inventory_balance_id;
        select z.warehouse_id into v_warehouse_id from public.locations l join public.warehouse_zones z on z.id=l.zone_id where l.id=v_allocation.location_id;
        insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_order.org_id,v_warehouse_id,v_allocation.product_id,v_allocation.location_id,'INBOUND',v_return_quantity,'SALES_ORDER',v_order.id,'Sales order rollback',auth.uid());
      else
        update public.inventory_balances set quantity_reserved=quantity_reserved-v_return_quantity where id=v_allocation.inventory_balance_id;
      end if;
      v_remaining := v_remaining-v_return_quantity;
    end loop;
  end loop;
  update public.order_items set quantity_reserved=0, quantity_picked=case when v_order.status='SHIPPED' then 0 else quantity_picked end where sales_order_id=p_sales_order_id;
  delete from public.order_item_allocations where order_item_id in (select id from public.order_items where sales_order_id=p_sales_order_id);
  update public.sales_orders set status='REVERTED' where id=p_sales_order_id;
end;
$$;

create or replace function rollback_purchase_order(p_purchase_order_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_po public.purchase_orders%rowtype; v_item record; v_warehouse_id uuid;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status = 'PENDING' then update public.purchase_orders set status='CANCELLED' where id=p_purchase_order_id; return; end if;
  -- COMPLETED is the legacy label used by early deployments; treat it as a
  -- received PO so historic records remain reversible.
  if v_po.status not in ('RECEIVED','COMPLETED') then raise exception 'only pending or received purchase orders can be rolled back'; end if;
  for v_item in select poi.*, z.warehouse_id from public.purchase_order_items poi join public.locations l on l.id=poi.location_id join public.warehouse_zones z on z.id=l.zone_id where poi.purchase_order_id=p_purchase_order_id loop
    if not exists(select 1 from public.inventory_balances where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='' and quantity_on_hand-v_item.quantity_received >= quantity_reserved) then raise exception 'purchase-order rollback would make bin stock lower than reserved stock'; end if;
    update public.inventory_balances set quantity_on_hand=quantity_on_hand-v_item.quantity_received where product_id=v_item.product_id and location_id=v_item.location_id and lot_number='';
    update public.purchase_order_items set quantity_received=0 where id=v_item.id;
    insert into public.inventory_transactions(org_id,warehouse_id,product_id,location_id,transaction_type,quantity_delta,reference_type,reference_id,reason,user_id) values(v_po.org_id,v_item.warehouse_id,v_item.product_id,v_item.location_id,'OUTBOUND',-v_item.quantity_received,'PURCHASE_ORDER',v_po.id,'Purchase order rollback',auth.uid());
  end loop;
  update public.purchase_orders set status='REVERTED' where id=p_purchase_order_id;
end;
$$;

create or replace function prevent_zone_delete_with_inventory()
returns trigger language plpgsql set search_path = public as $$
begin
  if exists(select 1 from public.inventory_balances b join public.locations l on l.id=b.location_id where l.zone_id=old.id and (b.quantity_on_hand <> 0 or b.quantity_reserved <> 0)) then raise exception 'zone cannot be deleted while its bins contain stock'; end if;
  return old;
end;
$$;
drop trigger if exists warehouse_zones_delete_guard on warehouse_zones;
create trigger warehouse_zones_delete_guard before delete on warehouse_zones for each row execute function prevent_zone_delete_with_inventory();

create or replace function update_purchase_order_with_lines(p_purchase_order_id uuid, p_supplier_name varchar, p_lines jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_po public.purchase_orders%rowtype; v_line jsonb;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if v_po.id is null then raise exception 'purchase order not found'; end if;
  if not public.is_org_role(v_po.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_po.status not in ('DRAFT','PENDING') then raise exception 'only draft or pending purchase orders can be edited'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'at least one inbound line is required'; end if;
  delete from public.purchase_order_items where purchase_order_id=p_purchase_order_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if coalesce((v_line->>'quantity')::integer,0) <= 0 then raise exception 'inbound quantity must be greater than zero'; end if;
    if not exists(select 1 from public.products where id=(v_line->>'productId')::uuid and org_id=v_po.org_id) then raise exception 'product does not belong to active organization'; end if;
    if not exists(select 1 from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where l.id=(v_line->>'locationId')::uuid and w.org_id=v_po.org_id and l.is_active) then raise exception 'receiving location is invalid'; end if;
    insert into public.purchase_order_items(purchase_order_id,product_id,location_id,quantity_expected) values(p_purchase_order_id,(v_line->>'productId')::uuid,(v_line->>'locationId')::uuid,(v_line->>'quantity')::integer);
  end loop;
  update public.purchase_orders set supplier_name=p_supplier_name where id=p_purchase_order_id;
end;
$$;
