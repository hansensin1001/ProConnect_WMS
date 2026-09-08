-- A picking bin represents where a reservation is staged. Inventory remains
-- traceable to its source balance for fulfilment and rollback, while the UI
-- can render the reservation as a distinct PICKING-bin state.
alter table public.order_item_allocations
  add column if not exists picking_location_id uuid references public.locations(id) on delete restrict;
create index if not exists idx_order_item_allocations_picking_location
  on public.order_item_allocations (picking_location_id)
  where picking_location_id is not null;

create or replace function public.allocate_sales_order(p_sales_order_id uuid, p_picking_location_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_order public.sales_orders%rowtype; v_item record; v_balance record;
begin
  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id,array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('NEW','DRAFT') then raise exception 'only new orders can be allocated'; end if;
  if p_picking_location_id is not null and not exists(select 1 from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id where l.id=p_picking_location_id and l.is_active and w.org_id=v_order.org_id) then raise exception 'picking location is invalid for the active organization'; end if;
  for v_item in select oi.*,p.is_serialized from public.order_items oi join public.products p on p.id=oi.product_id where oi.sales_order_id=p_sales_order_id for update of oi loop
    select b.id,b.location_id,b.quantity_on_hand,b.quantity_reserved into v_balance
    from public.inventory_balances b join public.locations l on l.id=b.location_id
    where b.product_id=v_item.product_id and b.lot_number='' and b.quantity_on_hand-b.quantity_reserved>=v_item.quantity_requested
      and (not v_item.is_serialized or (select count(*) from public.serial_numbers sn where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id and sn.location_id=b.location_id and sn.status='IN_STOCK')>=v_item.quantity_requested)
    order by coalesce(l.display_code,l.location_code),l.id for update of b limit 1;
    if v_balance.id is null then raise exception 'insufficient available stock for product %',v_item.product_id; end if;
    update public.inventory_balances set quantity_reserved=quantity_reserved+v_item.quantity_requested,updated_at=now() where id=v_balance.id;
    insert into public.order_item_allocations(order_item_id,inventory_balance_id,quantity_reserved,picking_location_id) values(v_item.id,v_balance.id,v_item.quantity_requested,p_picking_location_id);
    update public.order_items set quantity_reserved=quantity_requested where id=v_item.id;
  end loop;
  update public.sales_orders set status='ALLOCATED' where id=p_sales_order_id;
end;
$$;

-- PostgreSQL cannot alter a function's OUT/RETURNS TABLE shape in place. This
-- migration adds quantity_available, so replace the previous signature before
-- creating the new location-distribution function. No inventory records are
-- touched by this operation.
drop function if exists public.get_inventory_location_distribution(uuid, uuid, integer);

create function public.get_inventory_location_distribution(p_org_id uuid,p_product_id uuid,p_limit integer default 100)
returns table(location_id uuid,warehouse_name text,zone_code text,location_code text,quantity_on_hand bigint,quantity_reserved bigint,quantity_available bigint,quantity_inbound bigint)
language sql stable security invoker set search_path=public as $$
  with source_stock as (
    select b.location_id,sum(b.quantity_on_hand)::bigint as on_hand,sum(b.quantity_reserved)::bigint as total_reserved
    from public.inventory_balances b where b.product_id=p_product_id and (b.quantity_on_hand<>0 or b.quantity_reserved<>0) group by b.location_id
  ), picking_reservations as (
    select b.location_id as source_location_id,a.picking_location_id,sum(a.quantity_reserved-a.quantity_fulfilled)::bigint as reserved
    from public.order_item_allocations a join public.inventory_balances b on b.id=a.inventory_balance_id join public.order_items oi on oi.id=a.order_item_id join public.sales_orders so on so.id=oi.sales_order_id
    where oi.product_id=p_product_id and so.org_id=p_org_id and so.status='ALLOCATED' and a.picking_location_id is not null
    group by b.location_id,a.picking_location_id
  ), picked as (
    select picking_location_id,sum(reserved)::bigint as reserved from picking_reservations group by picking_location_id
  ), picked_from_source as (
    select source_location_id,sum(reserved)::bigint as reserved from picking_reservations group by source_location_id
  ), inbound as (
    select poi.location_id,sum(greatest(0,poi.quantity_expected-poi.quantity_received))::bigint as inbound
    from public.purchase_order_items poi join public.purchase_orders po on po.id=poi.purchase_order_id
    where poi.product_id=p_product_id and po.org_id=p_org_id and po.status in ('DRAFT','PENDING') group by poi.location_id
  ), rows as (
    select s.location_id,s.on_hand,(s.total_reserved-coalesce(ps.reserved,0))::bigint as reserved,s.on_hand-s.total_reserved as available,0::bigint as inbound from source_stock s left join picked_from_source ps on ps.source_location_id=s.location_id
    union all select picking_location_id,0::bigint,reserved,0::bigint,0::bigint from picked
    union all select location_id,0::bigint,0::bigint,0::bigint,inbound from inbound
  ), grouped as (
    select location_id,sum(on_hand)::bigint as on_hand,sum(reserved)::bigint as reserved,sum(available)::bigint as available,sum(inbound)::bigint as inbound from rows group by location_id
  )
  select g.location_id,coalesce(w.name,w.code,'[Unassigned Warehouse]'),coalesce(z.zone_code,'[Unassigned Zone]'),coalesce(l.display_code,l.location_code,'[Unassigned Bin]'),g.on_hand,g.reserved,g.available,g.inbound
  from grouped g left join public.locations l on l.id=g.location_id left join public.warehouse_zones z on z.id=l.zone_id left join public.warehouses w on w.id=z.warehouse_id and w.org_id=p_org_id
  order by coalesce(w.code,w.name,''),coalesce(z.zone_code,''),coalesce(l.display_code,l.location_code,''),g.location_id limit greatest(1,least(coalesce(p_limit,100),500));
$$;
