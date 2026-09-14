"use client";
import { PartialProcessing, type ProcessingLine } from "@/components/PartialProcessing";
type Order = { id: string; order_number: string; order_items?: ProcessingLine[] | null };
export function PartialShipmentConsole({ orgId, orders }: { orgId: string; orders: Order[] }) { return <PartialProcessing key={orgId} orgId={orgId} inbound={false} orders={orders.map((order) => ({ id: order.id, reference: order.order_number, lines: order.order_items ?? [] }))} />; }
