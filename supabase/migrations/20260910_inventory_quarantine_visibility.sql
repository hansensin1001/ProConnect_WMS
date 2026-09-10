-- Quarantine is a physically located, non-sellable inventory state. Keep it
-- separate from on-hand/available values while making it visible by SKU/bin.
alter table public.inventory_balances
  add column if not exists quantity_quarantined integer not null default 0
  check (quantity_quarantined >= 0);

create index if not exists idx_inventory_balances_product_quarantine
  on public.inventory_balances (product_id, location_id)
  where quantity_quarantined <> 0;

-- PostgreSQL requires dropping an existing function before changing its
-- RETURNS TABLE shape. This changes reporting only; it does not touch stock.
drop function if exists public.get_inventory_page_totals(uuid[]);
create function public.get_inventory_page_totals(p_product_ids uuid[])
returns table (
  product_id uuid,
  quantity_on_hand bigint,
  quantity_reserved bigint,
  quantity_quarantined bigint,
  location_count bigint
)
language sql stable security invoker set search_path = public as $$
  select
    b.product_id,
    coalesce(sum(b.quantity_on_hand), 0)::bigint as quantity_on_hand,
    coalesce(sum(b.quantity_reserved), 0)::bigint as quantity_reserved,
    coalesce(sum(b.quantity_quarantined), 0)::bigint as quantity_quarantined,
    count(distinct b.location_id)::bigint as location_count
  from public.inventory_balances b
  where b.product_id = any(p_product_ids)
    and (b.quantity_on_hand <> 0 or b.quantity_reserved <> 0 or b.quantity_quarantined <> 0)
  group by b.product_id;
$$;

drop function if exists public.get_inventory_location_distribution(uuid, uuid, integer);
create function public.get_inventory_location_distribution(
  p_org_id uuid,
  p_product_id uuid,
  p_limit integer default 100
)
returns table (
  location_id uuid,
  warehouse_name text,
  zone_code text,
  location_code text,
  quantity_on_hand bigint,
  quantity_reserved bigint,
  quantity_available bigint,
  quantity_inbound bigint,
  quantity_quarantined bigint
)
language sql stable security invoker set search_path = public as $$
  with source_stock as (
    select b.location_id,
      sum(b.quantity_on_hand)::bigint as on_hand,
      sum(b.quantity_reserved)::bigint as total_reserved
    from public.inventory_balances b
    where b.product_id = p_product_id
      and (b.quantity_on_hand <> 0 or b.quantity_reserved <> 0)
    group by b.location_id
  ), picking_reservations as (
    select b.location_id as source_location_id,
      a.picking_location_id,
      sum(a.quantity_reserved - a.quantity_fulfilled)::bigint as reserved
    from public.order_item_allocations a
    join public.inventory_balances b on b.id = a.inventory_balance_id
    join public.order_items oi on oi.id = a.order_item_id
    join public.sales_orders so on so.id = oi.sales_order_id
    where oi.product_id = p_product_id
      and so.org_id = p_org_id
      and so.status = 'ALLOCATED'
      and a.picking_location_id is not null
    group by b.location_id, a.picking_location_id
  ), picked as (
    select picking_location_id, sum(reserved)::bigint as reserved
    from picking_reservations
    group by picking_location_id
  ), picked_from_source as (
    select source_location_id, sum(reserved)::bigint as reserved
    from picking_reservations
    group by source_location_id
  ), inbound as (
    select poi.location_id,
      sum(greatest(0, poi.quantity_expected - poi.quantity_received))::bigint as inbound
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where poi.product_id = p_product_id
      and po.org_id = p_org_id
      and po.status in ('DRAFT', 'PENDING', 'PARTIALLY_RECEIVED')
    group by poi.location_id
  ), quarantined as (
    select b.location_id, sum(b.quantity_quarantined)::bigint as quarantined
    from public.inventory_balances b
    join public.locations l on l.id = b.location_id
    join public.warehouse_zones z on z.id = l.zone_id
    join public.warehouses w on w.id = z.warehouse_id
    where b.product_id = p_product_id
      and b.quantity_quarantined <> 0
      and w.org_id = p_org_id
    group by b.location_id
  ), rows as (
    select s.location_id,
      s.on_hand,
      (s.total_reserved - coalesce(ps.reserved, 0))::bigint as reserved,
      (s.on_hand - s.total_reserved)::bigint as available,
      0::bigint as inbound,
      0::bigint as quarantined
    from source_stock s
    left join picked_from_source ps on ps.source_location_id = s.location_id
    union all
    select picking_location_id, 0::bigint, reserved, 0::bigint, 0::bigint, 0::bigint from picked
    union all
    select location_id, 0::bigint, 0::bigint, 0::bigint, inbound, 0::bigint from inbound
    union all
    select location_id, 0::bigint, 0::bigint, 0::bigint, 0::bigint, quarantined from quarantined
  ), grouped as (
    select location_id,
      sum(on_hand)::bigint as on_hand,
      sum(reserved)::bigint as reserved,
      sum(available)::bigint as available,
      sum(inbound)::bigint as inbound,
      sum(quarantined)::bigint as quarantined
    from rows
    group by location_id
  )
  select
    g.location_id,
    coalesce(w.name, w.code, '[Unassigned Warehouse]') as warehouse_name,
    coalesce(z.zone_code, '[Unassigned Zone]') as zone_code,
    coalesce(l.display_code, l.location_code, '[Unassigned Bin]') as location_code,
    g.on_hand,
    g.reserved,
    g.available,
    g.inbound,
    g.quarantined
  from grouped g
  left join public.locations l on l.id = g.location_id
  left join public.warehouse_zones z on z.id = l.zone_id
  left join public.warehouses w on w.id = z.warehouse_id and w.org_id = p_org_id
  order by coalesce(w.code, w.name, ''), coalesce(z.zone_code, ''), coalesce(l.display_code, l.location_code, ''), g.location_id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
