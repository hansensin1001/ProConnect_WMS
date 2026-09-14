"use client";
import { ReturnWorkflow, type ReturnLine } from "@/components/ReturnWorkflow";
type Order = { id: string; po_number: string; supplier_name?: string | null; purchase_order_items?: ReturnLine[] | null };
export function RtvReturnConsoleV3({ orgId, purchaseOrders }: { orgId: string; purchaseOrders: Order[] }) {
  return <ReturnWorkflow key={orgId} kind="RTV" orgId={orgId} orders={purchaseOrders.map((order) => ({ id: order.id, reference: order.po_number, party: order.supplier_name ?? null, lines: order.purchase_order_items ?? [] }))} />;
}
