-- Optional descriptive context for a zone (for example, cold storage or bulk racks).
alter table public.warehouse_zones
  add column if not exists description text;
