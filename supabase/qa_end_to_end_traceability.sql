-- End-to-end WMS integration test. Run after all 20260909 migrations.
-- It uses a transaction and ROLLBACK: no fixtures or movements persist.
begin;

do $$
declare
  v_user uuid; v_org uuid:=gen_random_uuid(); v_warehouse uuid:=gen_random_uuid();
  v_storage_zone uuid:=gen_random_uuid(); v_quarantine_zone uuid:=gen_random_uuid();
  v_storage_bin uuid:=gen_random_uuid(); v_quarantine_bin uuid:=gen_random_uuid();
  v_product uuid:=gen_random_uuid(); v_po uuid; v_po_item uuid; v_so uuid; v_so_item uuid;
  v_rtv uuid; v_rma_good uuid; v_rma_damaged uuid; v_count uuid; v_carrier uuid:=gen_random_uuid();
  v_on_hand integer; v_reserved integer; v_quarantined integer;
begin
  select user_id into v_user from public.platform_admins order by created_at limit 1;
  if v_user is null then select id into v_user from auth.users order by created_at limit 1; end if;
  if v_user is null then raise exception 'QA requires one Supabase Authentication user'; end if;
  perform set_config('request.jwt.claim.sub',v_user::text,true);

  insert into public.organizations(id,name,slug,code) values(v_org,'Trace QA Org','trace-qa-'||left(v_org::text,8),'TQA');
  insert into public.org_members(org_id,user_id,role) values(v_org,v_user,'owner');
  insert into public.warehouses(id,org_id,code,name) values(v_warehouse,v_org,'TQA-WH','Trace QA Warehouse');
  insert into public.warehouse_zones(id,warehouse_id,zone_code,zone_type) values
    (v_storage_zone,v_warehouse,'STORAGE','STORAGE'),(v_quarantine_zone,v_warehouse,'QUARANTINE','QUARANTINE');
  insert into public.locations(id,zone_id,location_code,is_active) values
    (v_storage_bin,v_storage_zone,'TQA-STO-01',true),(v_quarantine_bin,v_quarantine_zone,'TQA-QUAR-01',true);
  insert into public.products(id,org_id,sku,barcode,name,unit_of_measure) values(v_product,v_org,'TQA-SKU','TQA-BAR','Trace QA Product','PCS');

  -- 1. Dock receiving: eight accepted units reach putaway; two damaged units
  -- are rejected at the dock and never create on-hand or quarantine stock.
  v_po:=public.create_purchase_order_with_lines(v_org,'QA Supplier',jsonb_build_array(jsonb_build_object('productId',v_product::text,'locationId',v_storage_bin::text,'quantity',10)));
  select id into v_po_item from public.purchase_order_items where purchase_order_id=v_po;
  perform public.receive_purchase_order_partial(v_po,jsonb_build_array(
    jsonb_build_object('purchase_order_item_id',v_po_item::text,'quantity',8,'disposition','AVAILABLE','rejected_serials','[]'::jsonb),
    jsonb_build_object('purchase_order_item_id',v_po_item::text,'quantity',2,'disposition','REJECTED','rejected_serials','[]'::jsonb)
  ));
  select quantity_on_hand,quantity_reserved,quantity_quarantined into v_on_hand,v_reserved,v_quarantined from public.inventory_balances where product_id=v_product and location_id=v_storage_bin and lot_number='';
  if v_on_hand<>8 or v_reserved<>0 or v_quarantined<>0 then raise exception 'Dock-receipt state invalid: expected 8/0/0, got %/%/%',v_on_hand,v_reserved,v_quarantined; end if;
  if not exists(select 1 from public.purchase_receipt_rejections where purchase_order_id=v_po and rejected_qty=2) then raise exception 'Dock rejection audit missing'; end if;
  if (select rejected_qty from public.purchase_order_items where id=v_po_item)<>2 then raise exception 'Rejected PO quantity was not retained'; end if;

  -- 2. Allocation and strict scanner validation. A wrong scan is logged and
  -- does not alter the allocation; a Manual AWB record then ships three units.
  v_so:=public.create_sales_order_with_lines(v_org,'QA Customer','MANUAL','1 Trace Street','QA City','10000',jsonb_build_array(jsonb_build_object('productId',v_product::text,'quantity',3)));
  select id into v_so_item from public.order_items where sales_order_id=v_so;
  -- There are legacy and picking-location overloads of this function. Use the
  -- full named signature so PostgreSQL never has to infer which one to call.
  perform public.allocate_sales_order(
    p_sales_order_id := v_so,
    p_picking_location_id := null
  );
  select quantity_on_hand,quantity_reserved into v_on_hand,v_reserved from public.inventory_balances where product_id=v_product and location_id=v_storage_bin and lot_number='';
  if v_on_hand<>8 or v_reserved<>3 then raise exception 'Allocation state invalid'; end if;
  perform public.log_mispick_attempt(v_org,v_so,v_so_item,'WRONG-TQA-BAR','WRONG_SKU');
  if not exists(select 1 from public.mispick_attempts where sales_order_id=v_so and order_item_id=v_so_item) then raise exception 'Mispick event missing'; end if;
  insert into public.carriers(id,organization_id,carrier_code,display_name,is_active,is_sandbox,encrypted_credentials,created_by,updated_by) values(v_carrier,v_org,'MANUAL','QA Manual Carrier',true,true,'manual',v_user,v_user);
  insert into public.carrier_shipments(organization_id,sales_order_id,carrier_id,service_code,tracking_number,status,provider_status,label_data,label_content_type,created_by,updated_by) values(v_org,v_so,v_carrier,'MANUAL','QA-AWB-001','LABEL_CREATED','LABEL_CREATED','QA label','text/plain',v_user,v_user);
  perform public.fulfill_sales_order(v_so);
  update public.carrier_shipments set status='SHIPPED',provider_status='SHIPPED',updated_by=v_user where sales_order_id=v_so;
  select quantity_on_hand,quantity_reserved into v_on_hand,v_reserved from public.inventory_balances where product_id=v_product and location_id=v_storage_bin and lot_number='';
  if v_on_hand<>5 or v_reserved<>0 then raise exception 'Shipment state invalid'; end if;
  if not exists(select 1 from public.sales_orders where id=v_so and status='SHIPPED') or not exists(select 1 from public.carrier_shipments where sales_order_id=v_so and status='SHIPPED') then raise exception 'AWB/ship linkage invalid'; end if;

  -- 3. Customer return: one good unit restocks STORAGE; one damaged unit is
  -- isolated in QUARANTINE and is excluded from available stock.
  v_rma_good:=public.create_rma_and_receive(v_org,v_so,'QA Customer',jsonb_build_array(jsonb_build_object('product_id',v_product::text,'location_id',v_storage_bin::text,'quantity',1,'disposition','PUTAWAY','reason','UNOPENED')));
  v_rma_damaged:=public.create_rma_and_receive(v_org,v_so,'QA Customer',jsonb_build_array(jsonb_build_object('product_id',v_product::text,'location_id',v_quarantine_bin::text,'quantity',1,'disposition','QUARANTINE','reason','DAMAGED')));
  select quantity_on_hand into v_on_hand from public.inventory_balances where product_id=v_product and location_id=v_storage_bin and lot_number='';
  select quantity_quarantined into v_quarantined from public.inventory_balances where product_id=v_product and location_id=v_quarantine_bin and lot_number='';
  if v_on_hand<>6 or v_quarantined<>1 then raise exception 'RMA routing invalid: on hand %, quarantine %',v_on_hand,v_quarantined; end if;
  if not exists(select 1 from public.rmas where id=v_rma_good and sales_order_id=v_so) or not exists(select 1 from public.rmas where id=v_rma_damaged and sales_order_id=v_so) then raise exception 'RMA SO trace missing'; end if;

  -- 4. Vendor return: only accepted PO stock in the original storage bin is
  -- eligible; dispatch removes exactly one on-hand unit and records a ledger event.
  v_rtv:=public.create_return_to_vendor(v_org,'QA Supplier',jsonb_build_array(jsonb_build_object('purchase_order_id',v_po::text,'product_id',v_product::text,'location_id',v_storage_bin::text,'quantity',1,'reason','SUPPLIER_RECALL')));
  perform public.dispatch_return_to_vendor(v_rtv);
  select quantity_on_hand into v_on_hand from public.inventory_balances where product_id=v_product and location_id=v_storage_bin and lot_number='';
  if v_on_hand<>5 then raise exception 'RTV state invalid'; end if;
  if not exists(select 1 from public.return_to_vendor_items where rtv_id=v_rtv and purchase_order_id=v_po) then raise exception 'RTV PO trace missing'; end if;

  -- 5. Cycle count: a discrepancy is held for approval and only then changes stock.
  v_count:=public.submit_cycle_count(v_org,jsonb_build_array(jsonb_build_object('product_id',v_product::text,'location_id',v_storage_bin::text,'physical_quantity',4,'reason_code','MISSING')));
  if not exists(select 1 from public.cycle_counts where id=v_count and status='PENDING_APPROVAL') then raise exception 'Cycle count approval gate missing'; end if;
  perform public.approve_cycle_count(v_count,true);
  select quantity_on_hand into v_on_hand from public.inventory_balances where product_id=v_product and location_id=v_storage_bin and lot_number='';
  if v_on_hand<>4 then raise exception 'Cycle count reconciliation invalid'; end if;

  -- 6. Reporting must retain PO/SO/return/bin links through every exception.
  if not exists(select 1 from public.get_traceability_report(v_org,null,null,null,null,null,null,'ALL',200,0) where event_type='PO_REJECTED' and purchase_order_number is not null and bin_path='[Dock — not put away]') then raise exception 'PO rejection report trace missing'; end if;
  if not exists(select 1 from public.get_traceability_report(v_org,null,null,null,null,null,null,'ALL',200,0) where event_type='RMA' and sales_order_number is not null and bin_path like '%QUARANTINE%') then raise exception 'RMA report trace missing'; end if;
  if not exists(select 1 from public.get_traceability_report(v_org,null,null,null,null,null,null,'ALL',200,0) where event_type='RTV' and purchase_order_number is not null and rtv_number is not null) then raise exception 'RTV report trace missing'; end if;
  if not exists(select 1 from public.get_traceability_report(v_org,null,null,null,null,null,null,'ALL',200,0) where event_type='CYCLE_COUNT' and status='APPROVED') then raise exception 'Cycle-count report trace missing'; end if;
end;
$$;

rollback;
