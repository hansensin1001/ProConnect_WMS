-- Explicit operational quantities retained alongside legacy field names.
-- Triggers keep the values synchronized for every existing PO/SO workflow.
alter table public.purchase_order_items add column if not exists ordered_qty integer not null default 0;
alter table public.purchase_order_items add column if not exists processed_qty integer not null default 0;
alter table public.purchase_order_items add column if not exists remaining_qty integer not null default 0 check (remaining_qty >= 0);
alter table public.order_items add column if not exists ordered_qty integer not null default 0;
alter table public.order_items add column if not exists processed_qty integer not null default 0;
alter table public.order_items add column if not exists remaining_qty integer not null default 0 check (remaining_qty >= 0);

update public.purchase_order_items set ordered_qty=quantity_expected,processed_qty=quantity_received,remaining_qty=greatest(0,quantity_expected-quantity_received);
update public.order_items set ordered_qty=quantity_requested,processed_qty=quantity_picked,remaining_qty=greatest(0,quantity_requested-quantity_picked);

create or replace function public.sync_po_quantity_tracking() returns trigger language plpgsql set search_path=public as $$
begin new.ordered_qty:=new.quantity_expected; new.processed_qty:=new.quantity_received; new.remaining_qty:=greatest(0,new.quantity_expected-new.quantity_received); return new; end; $$;
create or replace function public.sync_so_quantity_tracking() returns trigger language plpgsql set search_path=public as $$
begin new.ordered_qty:=new.quantity_requested; new.processed_qty:=new.quantity_picked; new.remaining_qty:=greatest(0,new.quantity_requested-new.quantity_picked); return new; end; $$;
drop trigger if exists po_quantity_tracking on public.purchase_order_items;
create trigger po_quantity_tracking before insert or update of quantity_expected,quantity_received on public.purchase_order_items for each row execute function public.sync_po_quantity_tracking();
drop trigger if exists so_quantity_tracking on public.order_items;
create trigger so_quantity_tracking before insert or update of quantity_requested,quantity_picked on public.order_items for each row execute function public.sync_so_quantity_tracking();

create index if not exists idx_po_items_remaining on public.purchase_order_items(purchase_order_id, remaining_qty);
create index if not exists idx_so_items_remaining on public.order_items(sales_order_id, remaining_qty);
