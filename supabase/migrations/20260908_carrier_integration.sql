-- Carrier configuration and shipment records are intentionally server-only.
-- Browser users receive a redacted summary through /api/carriers; encrypted
-- credentials are never readable through PostgREST/RLS.

create table if not exists public.carriers (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  carrier_code varchar(40) not null check (carrier_code in ('MANUAL', 'DHL_EXPRESS', 'NINJA_VAN')),
  display_name varchar(100) not null,
  is_active boolean not null default false,
  is_sandbox boolean not null default true,
  encrypted_credentials text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (organization_id, carrier_code)
);

alter table public.sales_orders
  add column if not exists carrier_id uuid references public.carriers(id) on delete set null,
  add column if not exists carrier_service varchar(100),
  add column if not exists tracking_number varchar(160),
  add column if not exists carrier_status varchar(60);

create table if not exists public.carrier_shipments (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  carrier_id uuid not null references public.carriers(id) on delete restrict,
  service_code varchar(100) not null default 'STANDARD',
  tracking_number varchar(160) not null,
  status varchar(60) not null default 'LABEL_CREATED' check (status in ('CREATING', 'LABEL_CREATED', 'SHIPPED', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED')),
  provider_status varchar(160),
  label_data text,
  label_content_type varchar(100),
  last_webhook_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (sales_order_id),
  unique (carrier_id, tracking_number)
);

create index if not exists idx_carriers_organization_active
  on public.carriers (organization_id, is_active, carrier_code);
create index if not exists idx_carrier_shipments_carrier_tracking
  on public.carrier_shipments (carrier_id, tracking_number);
create index if not exists idx_carrier_shipments_org_status
  on public.carrier_shipments (organization_id, status, updated_at desc);
create index if not exists idx_sales_orders_org_tracking
  on public.sales_orders (org_id, tracking_number) where tracking_number is not null;

alter table public.carriers enable row level security;
alter table public.carrier_shipments enable row level security;

-- Credentials, label payloads, and provider responses are accessible only from
-- server routes using the service role after membership has been verified.
revoke all on table public.carriers from anon, authenticated;
revoke all on table public.carrier_shipments from anon, authenticated;

drop trigger if exists carriers_record_audit on public.carriers;
create trigger carriers_record_audit before insert or update on public.carriers
for each row execute function public.apply_record_audit();

drop trigger if exists carrier_shipments_record_audit on public.carrier_shipments;
create trigger carrier_shipments_record_audit before insert or update on public.carrier_shipments
for each row execute function public.apply_record_audit();
