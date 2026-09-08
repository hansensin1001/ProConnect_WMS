-- ProConnect WMS transactional workflow verification
-- Run only after schema.sql and 20260908_serial_number_tracking.sql. This creates all fixtures inside a transaction
-- and ROLLS THEM BACK, so no test organization, stock, or order persists.
begin;

do $$
declare
  v_user uuid;
  v_org_a uuid := uuid_generate_v4();
  v_org_b uuid := uuid_generate_v4();
  v_warehouse uuid := uuid_generate_v4();
  v_zone uuid := uuid_generate_v4();
  v_location uuid := uuid_generate_v4();
  v_product_a uuid := uuid_generate_v4();
  v_product_b uuid := uuid_generate_v4();
  v_product_serial uuid := uuid_generate_v4();
  v_po uuid;
  v_serial_po uuid;
  v_so uuid;
  v_serial_so uuid;
  v_serial_po_item uuid;
  v_serial_so_item uuid;
  v_on_hand integer;
  v_reserved integer;
begin
  select user_id into v_user from public.platform_admins order by created_at limit 1;
  if v_user is null then select id into v_user from auth.users order by created_at limit 1; end if;
  if v_user is null then raise exception 'QA requires at least one Supabase Authentication user'; end if;

  insert into public.organizations(id, name, slug, code) values
    (v_org_a, 'QA Org A', 'qa-org-a-' || left(v_org_a::text, 8), 'QAA'),
    (v_org_b, 'QA Org B', 'qa-org-b-' || left(v_org_b::text, 8), 'QAB');
  insert into public.org_members(org_id, user_id, role) values
    (v_org_a, v_user, 'owner'), (v_org_b, v_user, 'owner');

  -- Exercise the same authenticated role checks that browser RPCs use.
  perform set_config('request.jwt.claim.sub', v_user::text, true);

  insert into public.warehouses(id, org_id, code, name) values (v_warehouse, v_org_a, 'QAWH', 'QA Warehouse');
  insert into public.warehouse_zones(id, warehouse_id, zone_code, zone_type) values (v_zone, v_warehouse, 'RCV', 'RECEIVING');
  insert into public.locations(id, zone_id, location_code) values (v_location, v_zone, 'QA-RCV-01');
  insert into public.products(id, org_id, sku, barcode, name, unit_of_measure) values
    (v_product_a, v_org_a, 'QA-SKU-A', 'QA-BAR-A', 'QA Product A', 'PCS'),
    (v_product_b, v_org_b, 'QA-SKU-B', 'QA-BAR-B', 'QA Product B', 'PCS');
  insert into public.products(id, org_id, sku, barcode, name, unit_of_measure, is_serialized)
    values (v_product_serial, v_org_a, 'QA-SKU-SERIAL', 'QA-BAR-SERIAL', 'QA Serial Product', 'PCS', true);

  -- Inbound: PO receipt must add exactly ten units in its selected bin.
  v_po := public.create_purchase_order_with_lines(v_org_a, 'QA Supplier', jsonb_build_array(jsonb_build_object('productId', v_product_a::text, 'locationId', v_location::text, 'quantity', 10)));
  perform public.receive_purchase_order(v_po);
  select quantity_on_hand, quantity_reserved into v_on_hand, v_reserved from public.inventory_balances where product_id = v_product_a and location_id = v_location;
  if v_on_hand <> 10 or v_reserved <> 0 then raise exception 'Inbound check failed: expected 10 on hand / 0 reserved, got % / %', v_on_hand, v_reserved; end if;

  -- Outbound: allocation reserves stock, fulfilment consumes exactly the reservation.
  v_so := public.create_sales_order_with_lines(v_org_a, 'QA Customer', 'MANUAL', '1 QA Street', 'QA City', '00000', jsonb_build_array(jsonb_build_object('productId', v_product_a::text, 'quantity', 3)));
  perform public.allocate_sales_order(v_so);
  select quantity_on_hand, quantity_reserved into v_on_hand, v_reserved from public.inventory_balances where product_id = v_product_a and location_id = v_location;
  if v_on_hand <> 10 or v_reserved <> 3 then raise exception 'Reservation check failed: expected 10 on hand / 3 reserved, got % / %', v_on_hand, v_reserved; end if;
  perform public.fulfill_sales_order(v_so);
  select quantity_on_hand, quantity_reserved into v_on_hand, v_reserved from public.inventory_balances where product_id = v_product_a and location_id = v_location;
  if v_on_hand <> 7 or v_reserved <> 0 then raise exception 'Fulfilment check failed: expected 7 on hand / 0 reserved, got % / %', v_on_hand, v_reserved; end if;

  -- Serialised inbound and outbound: receipt count, exact scan gate, ship state
  -- and rollback are all verified inside the same transaction.
  v_serial_po := public.create_purchase_order_with_lines(v_org_a, 'QA Serial Supplier', jsonb_build_array(jsonb_build_object('productId', v_product_serial::text, 'locationId', v_location::text, 'quantity', 2)));
  select id into v_serial_po_item from public.purchase_order_items where purchase_order_id=v_serial_po;
  perform public.receive_purchase_order(v_serial_po, jsonb_build_array(
    jsonb_build_object('purchase_order_item_id', v_serial_po_item::text, 'serial_number', 'QA-SERIAL-001'),
    jsonb_build_object('purchase_order_item_id', v_serial_po_item::text, 'serial_number', 'QA-SERIAL-002')
  ));
  if (select count(*) from public.serial_numbers where purchase_order_id=v_serial_po and status='IN_STOCK') <> 2 then raise exception 'Serial receipt check failed'; end if;
  v_serial_so := public.create_sales_order_with_lines(v_org_a, 'QA Serial Customer', 'MANUAL', null, null, null, jsonb_build_array(jsonb_build_object('productId', v_product_serial::text, 'quantity', 1)));
  perform public.allocate_sales_order(v_serial_so);
  select id into v_serial_so_item from public.order_items where sales_order_id=v_serial_so;
  perform public.fulfill_sales_order_with_serials(v_serial_so, jsonb_build_array(jsonb_build_object('order_item_id', v_serial_so_item::text, 'serial_number', 'QA-SERIAL-001')));
  if not exists(select 1 from public.serial_numbers where serial_number='QA-SERIAL-001' and status='SHIPPED' and sales_order_id=v_serial_so) then raise exception 'Serial shipment state check failed'; end if;
  perform public.rollback_sales_order(v_serial_so);
  if not exists(select 1 from public.serial_numbers where serial_number='QA-SERIAL-001' and status='IN_STOCK' and sales_order_id is null) then raise exception 'Serial shipment rollback check failed'; end if;

  -- Tenant boundary: an Org B SKU cannot be inserted into an Org A order.
  begin
    perform public.create_sales_order_with_lines(v_org_a, 'Invalid cross-org order', 'MANUAL', null, null, null, jsonb_build_array(jsonb_build_object('productId', v_product_b::text, 'quantity', 1)));
    raise exception 'Cross-organization SKU was incorrectly accepted';
  exception when others then
    if position('product does not belong to active organization' in sqlerrm) = 0 then raise; end if;
  end;

  -- Defensive checks: stock-holding bins and allocated orders cannot be deleted.
  begin
    delete from public.locations where id = v_location;
    raise exception 'Stock-holding location was incorrectly deleted';
  exception when others then
    if position('location cannot be deleted while it contains stock' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    delete from public.sales_orders where id = v_so;
    raise exception 'Fulfilled sales order was incorrectly deleted';
  exception when others then
    if position('only new sales orders can be deleted' in sqlerrm) = 0 then raise; end if;
  end;

  if (select count(*) from public.inventory_transactions where reference_id in (v_po, v_so)) <> 2 then
    raise exception 'Movement ledger check failed';
  end if;
end;
$$;

rollback;

-- Supabase should return: Success. No rows returned.
