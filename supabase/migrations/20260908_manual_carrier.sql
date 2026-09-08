-- Existing deployments may already have the original two-carrier constraint.
-- Extend it without touching configured credentials or shipment history.
alter table public.carriers drop constraint if exists carriers_carrier_code_check;
alter table public.carriers add constraint carriers_carrier_code_check
  check (carrier_code in ('MANUAL', 'DHL_EXPRESS', 'NINJA_VAN'));
