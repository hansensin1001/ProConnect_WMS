-- ============================================================================
-- Optional seed data — a starter org, warehouse, zone and a few locations so
-- the app isn't empty on first login. Run AFTER schema.sql.
--
-- IMPORTANT: replace 'YOUR-AUTH-USER-UUID' with your own user id, which you
-- get after creating your first user in Supabase Auth (Authentication > Users
-- > copy the UUID), then run this in the SQL editor.
-- ============================================================================

do $$
declare
  v_org_id uuid;
  v_warehouse_id uuid;
  v_zone_id uuid;
  v_user_id uuid := 'YOUR-AUTH-USER-UUID'; -- <-- replace this
begin
  insert into organizations (name, slug, deployment_mode)
  values ('PostHub Simpang Ampat', 'posthub-simpang-ampat', 'managed')
  returning id into v_org_id;

  insert into org_members (org_id, user_id, role)
  values (v_org_id, v_user_id, 'owner');

  insert into warehouses (org_id, code, name, address)
  values (v_org_id, 'PH-SA', 'PostHub Simpang Ampat', 'Simpang Ampat, Penang, Malaysia')
  returning id into v_warehouse_id;

  insert into warehouse_zones (warehouse_id, zone_code, zone_type)
  values (v_warehouse_id, 'ZONE-A', 'STORAGE')
  returning id into v_zone_id;

  insert into locations (zone_id, location_code, aisle, rack, shelf, bin)
  values
    (v_zone_id, 'A-01-01-A', '01', '01', '01', 'A'),
    (v_zone_id, 'A-01-01-B', '01', '01', '01', 'B'),
    (v_zone_id, 'A-01-02-A', '01', '02', '01', 'A');

  insert into products (org_id, sku, barcode, name, unit_of_measure)
  values
    (v_org_id, 'SKU-0001', '8991234560001', 'Sample Product A', 'PCS'),
    (v_org_id, 'SKU-0002', '8991234560002', 'Sample Product B', 'PCS');
end $$;
