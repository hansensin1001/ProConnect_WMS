-- Route-level indexes for the WMS list and document-detail queries.
-- Existing primary keys and unique constraints already cover warehouses,
-- warehouse_zones, products, and inventory_balances' primary lookups.

-- Purchase and sales-order documents: tenant filter + newest-first list order.
create index if not exists idx_purchase_orders_org_created_desc
  on public.purchase_orders (org_id, created_at desc);
create index if not exists idx_sales_orders_org_created_desc
  on public.sales_orders (org_id, created_at desc);

-- Child-item and allocation lookups used in document drawers and RPCs.
create index if not exists idx_purchase_order_items_location
  on public.purchase_order_items (location_id);
create index if not exists idx_purchase_order_items_product
  on public.purchase_order_items (product_id);
create index if not exists idx_order_items_product
  on public.order_items (product_id);
create index if not exists idx_order_item_allocations_order_item
  on public.order_item_allocations (order_item_id);
create index if not exists idx_order_item_allocations_balance
  on public.order_item_allocations (inventory_balance_id);

-- Inventory allocation and detail lookups only need current non-zero rows.
create index if not exists idx_inventory_balances_active_product_updated
  on public.inventory_balances (product_id, updated_at desc, id)
  where quantity_on_hand <> 0 or quantity_reserved <> 0;
create index if not exists idx_inventory_balances_allocatable_product
  on public.inventory_balances (product_id, updated_at, id)
  where quantity_on_hand > quantity_reserved;

-- Serial visibility queries are always tenant- and document-scoped.
create index if not exists idx_serial_numbers_org_purchase_received
  on public.serial_numbers (org_id, purchase_order_id, received_at)
  where purchase_order_id is not null;
create index if not exists idx_serial_numbers_org_sales_shipped
  on public.serial_numbers (org_id, sales_order_id, shipped_at)
  where sales_order_id is not null and status = 'SHIPPED';

-- Reports use a tenant/date ledger scan; the existing index is retained but
-- this composite index also supports transaction-type filtering.
create index if not exists idx_inventory_transactions_org_type_created
  on public.inventory_transactions (org_id, transaction_type, created_at desc);
create index if not exists idx_inventory_transactions_org_warehouse_created
  on public.inventory_transactions (org_id, warehouse_id, created_at desc);
create index if not exists idx_inventory_transactions_org_product_created
  on public.inventory_transactions (org_id, product_id, created_at desc);
create index if not exists idx_inventory_transactions_org_location_created
  on public.inventory_transactions (org_id, location_id, created_at desc);

-- Scanner and serial foreign-key access paths.
create index if not exists idx_scan_events_warehouse
  on public.scan_events (warehouse_id);
create index if not exists idx_scan_events_product
  on public.scan_events (product_id);
create index if not exists idx_scan_events_location
  on public.scan_events (location_id);
create index if not exists idx_serial_numbers_available_serial
  on public.serial_numbers (org_id, product_id, serial_number)
  include (location_id)
  where status = 'IN_STOCK';
create index if not exists idx_serial_numbers_sales_order_item
  on public.serial_numbers (sales_order_item_id)
  where sales_order_item_id is not null;

analyze public.order_items;
analyze public.purchase_order_items;
analyze public.order_item_allocations;
analyze public.inventory_balances;
analyze public.inventory_transactions;
analyze public.serial_numbers;
