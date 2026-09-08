-- A selected picking bin is validated in the same transaction as reservation.
-- Omitting it deterministically chooses the first active bin able to fulfil
-- the complete order line (display/location code, then location UUID).
create or replace function public.allocate_sales_order(
  p_sales_order_id uuid,
  p_picking_location_id uuid default null
) returns void language plpgsql security definer set search_path = public as $$
declare
  v_order public.sales_orders%rowtype;
  v_item record;
  v_balance record;
  v_available integer;
  v_selected_location uuid;
begin
  select * into v_order from public.sales_orders where id = p_sales_order_id for update;
  if v_order.id is null then raise exception 'sales order not found'; end if;
  if not public.is_org_role(v_order.org_id, array['owner','manager']) then raise exception 'manager or owner access is required'; end if;
  if v_order.status not in ('NEW','DRAFT') then raise exception 'only new orders can be allocated'; end if;

  if p_picking_location_id is not null and not exists (
    select 1 from public.locations l join public.warehouse_zones z on z.id=l.zone_id join public.warehouses w on w.id=z.warehouse_id
    where l.id=p_picking_location_id and l.is_active and w.org_id=v_order.org_id
  ) then raise exception 'picking location is invalid for the active organization'; end if;

  for v_item in select oi.*, p.is_serialized from public.order_items oi join public.products p on p.id=oi.product_id where oi.sales_order_id=p_sales_order_id for update of oi loop
    if p_picking_location_id is not null then
      select b.id,b.location_id,b.quantity_on_hand,b.quantity_reserved into v_balance
      from public.inventory_balances b where b.product_id=v_item.product_id and b.location_id=p_picking_location_id and b.lot_number='' for update;
    elsif v_item.is_serialized then
      select b.id,b.location_id,b.quantity_on_hand,b.quantity_reserved into v_balance
      from public.inventory_balances b join public.locations l on l.id=b.location_id
      where b.product_id=v_item.product_id and b.lot_number='' and b.quantity_on_hand-b.quantity_reserved>=v_item.quantity_requested
        and (select count(*) from public.serial_numbers sn where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id and sn.location_id=b.location_id and sn.status='IN_STOCK')>=v_item.quantity_requested
      order by coalesce(l.display_code,l.location_code),l.id for update of b limit 1;
    else
      select b.id,b.location_id,b.quantity_on_hand,b.quantity_reserved into v_balance
      from public.inventory_balances b join public.locations l on l.id=b.location_id
      where b.product_id=v_item.product_id and b.lot_number='' and b.quantity_on_hand-b.quantity_reserved>=v_item.quantity_requested
      order by coalesce(l.display_code,l.location_code),l.id for update of b limit 1;
    end if;
    if v_balance.id is null or v_balance.quantity_on_hand-v_balance.quantity_reserved<v_item.quantity_requested then raise exception 'insufficient available stock in the selected picking location for product %',v_item.product_id; end if;
    if v_item.is_serialized and (select count(*) from public.serial_numbers sn where sn.org_id=v_order.org_id and sn.product_id=v_item.product_id and sn.location_id=v_balance.location_id and sn.status='IN_STOCK')<v_item.quantity_requested then raise exception 'insufficient serialised stock in the selected picking location for product %',v_item.product_id; end if;
    update public.inventory_balances set quantity_reserved=quantity_reserved+v_item.quantity_requested,updated_at=now() where id=v_balance.id;
    insert into public.order_item_allocations(order_item_id,inventory_balance_id,quantity_reserved) values(v_item.id,v_balance.id,v_item.quantity_requested);
    update public.order_items set quantity_reserved=quantity_requested where id=v_item.id;
  end loop;
  update public.sales_orders set status='ALLOCATED' where id=p_sales_order_id;
end;
$$;
