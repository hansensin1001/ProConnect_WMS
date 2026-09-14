# Operator UX audit — 14 September 2026

Changes are saved directly in this repository. This is a code and local-fixture audit, not certification of the deployed warehouse/database. No production transactions or migrations were executed, and no commit, push or deployment was performed by this audit.

## Critical findings and implemented corrections

1. **Scanner and submission friction:** duplicate serial batches, accidental Enter submission, repeated clicks and stale remaining quantities could confuse operators. Shared scanner controls now normalize scanner suffixes, reject duplicate/over-count batches atomically and retain scan focus. Partial receipt/shipment forms clear physical quantities after posting and immediately reduce their local remaining balance. Partial shipments now verify the product against the server's allocated-order scan endpoint, visibly block mismatches, and require a new scan after each dispatch. The endpoint logs mismatches; live audit persistence still needs Supabase validation.
2. **Stock-state and destination ambiguity:** returns need eligible destinations, not arbitrary first bins. RMA defaults respect inspected condition (STORAGE versus QUARANTINE), RTV validates accepted source stock, and absent eligible bins display blocking alerts. Inventory detail uses separate responsive location cards for available, reserved, inbound and quarantined balances. Added SQL guards restrict allocation/accepted receiving to active organization-owned storage bins and prevent unsafe cycle-count adjustments.
3. **Clipped interfaces and misleading feedback:** drawers and action menus use portals; drawers support focus containment and mobile scrolling. Inventory/PO/SO lists use handheld cards, controls have larger touch targets, destructive row actions require confirmation, and workflow errors are visible inside the active panel. Late inventory lookup failures no longer replace feedback for a newer selection. Shipment-detail API failures return readable JSON instead of an uncaught route failure.

An additional traceability defect was found in AWB reprinting: rebuilding from mutable order data substituted a fixed 0.5 kg weight and default service. Reprint now returns the saved label unchanged, preserving its original parcel data and AWB. It does not allocate, ship again, or silently rewrite historical labels. Existing labels needing correction require a separate controlled correction workflow, not reprint.

## Affected modules

- Shared interaction: `components/ui/Drawer.tsx`, `RowActions.tsx`, `StatusBadge.tsx`, `SerialScanner.tsx`, `WorkflowNotice.tsx`, `lib/warehouse-ui.ts`.
- Operations: `components/ReturnWorkflow.tsx`, `PartialProcessing.tsx`, their RMA/RTV/partial wrappers, `CycleCountConsole.tsx`, `InventoryTableV2.tsx`, `OrderManager.tsx`, `PurchaseOrderManager.tsx`, `LocationManager.tsx`.
- Layout: `components/Sidebar.tsx`, `app/(app)/layout.tsx`, `app/globals.css`.
- Supporting scoped page queries and APIs: return, partial-processing, cycle-count, PO pages; exceptions, location-options, order serial-options and shipping-label routes.
- Database guards: `supabase/migrations/20260914_operator_workflow_guards.sql`.
- Repeatable helper tests: `tests/warehouse-ui.test.cjs`.

Some of the above changes were already committed in the repository before this continuation. Review `git diff` for the remaining uncommitted changes; do not replace the entire repository.

## Verification evidence

- `npx tsc --noEmit --incremental false`: passed.
- `node --test tests/warehouse-ui.test.cjs`: 8 tests passed. Covers receipt/shipment ceilings, serial delimiters, duplicate and over-count atomicity, malformed inputs, location labels and plain database errors.
- `git diff --check`: passed (Windows line-ending warnings only).
- Browser tests using actual React components and **mock HTTP responses**: duplicate serial blocked; Enter/Tab committed scans without posting stock; successful return locked repeat submission; missing eligible return bin blocked; over-receipt displayed an immediate error; receiving 2 of 5 remaining left 3; wrong-SKU partial dispatch blocked; valid-SKU dispatch of 2 from 4 allocated remaining left 2 and reset the scan gate.
- At 390 × 844, inventory rows became readable cards and the detail drawer showed distinct STORAGE/LOC1 and PICKING/PIK1 location cards without a horizontal table bottleneck.
- Production `npm run build`: did not complete locally and was stopped. **Not verified.**
- Real Supabase RPCs, RLS, concurrent stock mutations, carrier integration and a deployed full PO → SO → return → count lifecycle: **not executed**. Local Supabase credentials and a PostgreSQL test server were unavailable.

## Rollout and remaining limitations

1. Review the local diff and run the helper/TypeScript checks above.
2. Validate `20260914_operator_workflow_guards.sql` against a staging copy with the existing serial-return/exception migrations applied. This replaces existing functions with unchanged signatures; it is not a standalone database installation. Do not assume local TypeScript tests validate SQL execution.
3. On staging, verify dock rejection creates no balance, accepted receipt increments exactly once, partial dispatch cannot exceed allocation, and shortages roll back the transaction. Check RMA/RTV source links and condition-specific destination paths.
4. Verify cycle-count approval rejects stale counts, reserved-stock reductions, serialized quantity changes without serial reconciliation, mixed quarantine quantities and ambiguous multi-lot adjustments. These cases intentionally block rather than fabricate inventory corrections.
5. Serialized **partial** receipts/shipments are not implemented in the installed stock RPCs. The UI explicitly blocks them and links to the full-order serial workflow; it never treats serialized goods as standard quantities.
6. A successful barcode verification is a UI workflow gate, not proof of a physical bin scan or a durable server-issued fulfillment authorization. Final quantities/serial eligibility remain the stock RPC's responsibility. A stricter recorded pick-session protocol would require further backend work.
7. Reprint an existing AWB and compare its weight/address/service with the saved original. Confirm reprint does not change stock or create a new carrier shipment.
8. After staging validation, apply the reviewed migration in Supabase, commit/push the code and redeploy. Verify the production build and operator smoke tests before release.

No assertion is made that every historical workflow or live deployment is now defect-free.
