-- Deterministic SKU location distribution. Explicit joins avoid relying on
-- nested PostgREST relationship-shape inference in the client/API layer.
create or replace function public.get_inventory_location_distribution(
  p_org_id uuid,
  p_product_id uuid,
  p_limit integer default 100
) returns table (
  location_id uuid,
  warehouse_name text,
  zone_code text,
  location_code text,
  quantity_on_hand bigint,
  quantity_reserved bigint,
  quantity_inbound bigint
) language sql stable security invoker set search_path = public as $$
  with on_hand as (
    select b.location_id,
      sum(b.quantity_on_hand)::bigint as quantity_on_hand,
      sum(b.quantity_reserved)::bigint as quantity_reserved
    from public.inventory_balances b
    where b.product_id = p_product_id
      and (b.quantity_on_hand <> 0 or b.quantity_reserved <> 0)
    group by b.location_id
  ), inbound as (
    select poi.location_id,
      sum(greatest(0, poi.quantity_expected - poi.quantity_received))::bigint as quantity_inbound
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where poi.product_id = p_product_id
      and po.org_id = p_org_id
      and po.status in ('DRAFT', 'PENDING')
    group by poi.location_id
  ), location_ids as (
    select location_id from on_hand
    union
    select location_id from inbound
  )
  select
    location_ids.location_id,
    coalesce(w.name, w.code, '[Unassigned Warehouse]') as warehouse_name,
    coalesce(z.zone_code, '[Unassigned Zone]') as zone_code,
    coalesce(l.display_code, l.location_code, '[Unassigned Bin]') as location_code,
    coalesce(on_hand.quantity_on_hand, 0) as quantity_on_hand,
    coalesce(on_hand.quantity_reserved, 0) as quantity_reserved,
    coalesce(inbound.quantity_inbound, 0) as quantity_inbound
  from location_ids
  left join on_hand on on_hand.location_id = location_ids.location_id
  left join inbound on inbound.location_id = location_ids.location_id
  left join public.locations l on l.id = location_ids.location_id
  left join public.warehouse_zones z on z.id = l.zone_id
  left join public.warehouses w on w.id = z.warehouse_id and w.org_id = p_org_id
  order by coalesce(w.code, w.name, ''), coalesce(z.zone_code, ''), coalesce(l.display_code, l.location_code, ''), location_ids.location_id
  limit greatest(1, least(coalesce(p_limit, 100), 500));
$$;
