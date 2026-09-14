"use client";
import { ReturnWorkflow, type ReturnBin, type ReturnLine } from "@/components/ReturnWorkflow";
type Order = { id: string; order_number: string; customer_name?: string | null; order_items?: ReturnLine[] | null };
export function RmaReturnConsoleV3({ orgId, salesOrders, bins }: { orgId: string; salesOrders: Order[]; bins: ReturnBin[] }) {
  return <ReturnWorkflow key={orgId} kind="RMA" orgId={orgId} orders={salesOrders.map((order) => ({ id: order.id, reference: order.order_number, party: order.customer_name ?? null, lines: order.order_items ?? [] }))} bins={bins} />;
}
