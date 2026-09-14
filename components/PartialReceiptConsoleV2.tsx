"use client";
import { PartialProcessing, type ProcessingLine } from "@/components/PartialProcessing";
type Order = { id: string; po_number: string; purchase_order_items?: ProcessingLine[] | null };
export function PartialReceiptConsoleV2({ orgId, orders }: { orgId: string; orders: Order[] }) { return <PartialProcessing key={orgId} orgId={orgId} inbound orders={orders.map((order) => ({ id: order.id, reference: order.po_number, lines: order.purchase_order_items ?? [] }))} />; }
