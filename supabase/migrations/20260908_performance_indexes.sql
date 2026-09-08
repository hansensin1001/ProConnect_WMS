-- ProConnect WMS performance migration
-- Run this once in the Supabase SQL Editor before deploying the matching app code.

-- The existing unique constraints already index these frequent lookups:
--   warehouses(org_id, code)
--   warehouse_zones(warehouse_id, zone_code)
--   products(org_id, sku)
--   inventory_balances(product_id, location_id, lot_number)

-- Supports the paginated Locations route: zone lookup, active state and sort.
create index if not exists idx_locations_zone_active_code
  on public.locations (zone_id, is_active, location_code);

-- Supports case-insensitive partial SKU/name search without scanning the
-- complete product catalogue. pg_trgm is supplied by Supabase Postgres.
create extension if not exists pg_trgm;
create index if not exists idx_products_sku_trgm
  on public.products using gin (sku gin_trgm_ops);
create index if not exists idx_products_name_trgm
  on public.products using gin (name gin_trgm_ops);

-- Excludes historical zero-balance rows from stock-summary aggregation.
create index if not exists idx_inventory_balances_product_nonzero
  on public.inventory_balances (product_id)
  where quantity_on_hand <> 0 or quantity_reserved <> 0;

-- Returns one compact stock summary per product instead of returning every
-- bin/lot row to the Inventory route. As SECURITY INVOKER, existing RLS rules
-- still control exactly which balances a caller may read.
create or replace function public.get_inventory_page_totals(p_product_ids uuid[])
returns table (
  product_id uuid,
  quantity_on_hand bigint,
  quantity_reserved bigint,
  location_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    b.product_id,
    coalesce(sum(b.quantity_on_hand), 0)::bigint as quantity_on_hand,
    coalesce(sum(b.quantity_reserved), 0)::bigint as quantity_reserved,
    count(distinct b.location_id)::bigint as location_count
  from public.inventory_balances b
  where b.product_id = any(p_product_ids)
    and (b.quantity_on_hand <> 0 or b.quantity_reserved <> 0)
  group by b.product_id;
$$;
