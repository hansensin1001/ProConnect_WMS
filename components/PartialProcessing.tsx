"use client";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { WorkflowNotice, type Notice } from "@/components/ui/WorkflowNotice";
import { SerialScanner } from "@/components/ui/SerialScanner";
import { binLabel, receiptRemaining, shippableQuantity, warehouseError } from "@/lib/warehouse-ui";

export type ProcessingLine = { id: string; quantity_expected?: number; quantity_received?: number; rejected_qty?: number; quantity_requested?: number; quantity_picked?: number; quantity_reserved?: number; location_id?: string; products?: { sku?: string; name?: string; is_serialized?: boolean | null } | null; locations?: { display_code?: string | null; location_code?: string } | null };
export type ProcessingOrder = { id: string; reference: string; lines: ProcessingLine[] };
const remaining = (line: ProcessingLine, inbound: boolean) => inbound
  ? receiptRemaining({ quantity_expected: line.quantity_expected ?? 0, quantity_received: line.quantity_received ?? 0, rejected_qty: line.rejected_qty })
  : shippableQuantity({ quantity_requested: line.quantity_requested ?? 0, quantity_picked: line.quantity_picked ?? 0, quantity_reserved: line.quantity_reserved });

export function PartialProcessing({ orgId, orders, inbound }: { orgId: string; orders: ProcessingOrder[]; inbound: boolean }) {
  const router = useRouter();
  const [localOrders, setLocalOrders] = useState(orders);
  const [orderId, setOrderId] = useState(orders.length === 1 ? orders[0].id : "");
  const [lineId, setLineId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [decision, setDecision] = useState("AVAILABLE");
  const [serials, setSerials] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => setLocalOrders(orders), [orders]);
  const order = localOrders.find((item) => item.id === orderId);
  const availableLines = useMemo(() => (order?.lines ?? []).filter((line) => remaining(line, inbound) > 0), [order, inbound]);
  useEffect(() => { setLineId((current) => availableLines.some((line) => line.id === current) ? current : availableLines[0]?.id ?? ""); }, [availableLines]);
  useEffect(() => { setQuantity(""); setSerials([]); }, [orderId, lineId, decision]);
  const line = availableLines.find((item) => item.id === lineId);
  const balance = line ? remaining(line, inbound) : 0;
  const serialized = Boolean(line?.products?.is_serialized);
  const serialWorkflowRequired = serialized && (!inbound || decision === "AVAILABLE");
  const missingBin = inbound && decision === "AVAILABLE" && !line?.location_id;
  const count = Number(quantity);
  const ready = Boolean(line && !missingBin && !serialWorkflowRequired && Number.isSafeInteger(count) && count > 0 && count <= balance && (!serialized || serials.length === count));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (lock.current) return;
    if (!ready) { setNotice({ kind: "error", text: "Select a valid line, receiving bin, and a whole quantity within its remaining balance." }); return; }
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const payload = inbound ? { action: "partialReceipt", receipts: [{ purchaseOrderItemId: lineId, quantity: count, disposition: decision, rejectedSerials: decision === "REJECTED" ? serials : [] }] }
        : { action: "partialShip", lines: [{ orderItemId: lineId, quantity: count }] };
      const response = await fetch("/api/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, orderId, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to process the document.");
      // Update the local ceiling immediately; subsequent scans cannot use the old balance.
      setLocalOrders((current) => current.map((item) => item.id !== orderId ? item : { ...item, lines: item.lines.map((row) => row.id !== lineId ? row : inbound ? decision === "REJECTED" ? { ...row, rejected_qty: (row.rejected_qty ?? 0) + count } : { ...row, quantity_received: (row.quantity_received ?? 0) + count } : { ...row, quantity_picked: (row.quantity_picked ?? 0) + count }) }));
      setQuantity(""); setSerials([]);
      setNotice({ kind: "success", text: decision === "REJECTED" && inbound ? `${count} units rejected at the dock. No inventory was created. ${balance - count} units remain unresolved on this line.` : `${count} units ${inbound ? "received" : "shipped"}. ${balance - count} units remain on this line.` });
      router.refresh();
    } catch (error) { setNotice({ kind: "error", text: warehouseError(error, "Unable to confirm processing. Check the document before retrying if your connection was interrupted.") }); }
    finally { lock.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="max-w-3xl rounded-xl border border-line bg-panel p-4 sm:p-6">
    <h2 className="text-lg font-semibold">{inbound ? "Receive purchase order" : "Dispatch part of an order"}</h2>
    <p className="mt-1 text-sm text-graphite">{inbound ? "Enter only the units physically accepted now. Reject damaged deliveries at the dock without placing them into stock." : "Enter only the units physically leaving the warehouse. The remaining allocation stays open."}</p>
    <WorkflowNotice notice={notice} />
    <fieldset disabled={busy} className="mt-5 space-y-4">
      <label className="block text-sm font-medium">{inbound ? "Purchase order" : "Sales order"}<select value={orderId} onChange={(event) => { setOrderId(event.target.value); setLineId(""); setNotice(null); }} required className="input-field mt-1"><option value="">Select document…</option>{localOrders.filter((item) => item.lines.some((row) => remaining(row, inbound) > 0)).map((item) => <option key={item.id} value={item.id}>{item.reference}</option>)}</select></label>
      <label className="block text-sm font-medium">Unprocessed line<select required value={lineId} onChange={(event) => { setLineId(event.target.value); setNotice(null); }} disabled={!availableLines.length} className="input-field mt-1"><option value="">Select line…</option>{availableLines.map((item) => <option key={item.id} value={item.id}>{item.products?.sku} · {item.products?.name} · {remaining(item, inbound)} remaining</option>)}</select></label>
      {inbound && <label className="block text-sm font-medium">Receiving decision<select value={decision} onChange={(event) => setDecision(event.target.value)} className="input-field mt-1"><option value="AVAILABLE">Accept into assigned bin</option><option value="REJECTED">Reject damaged units at the dock</option></select></label>}
      {line && <div className="rounded-lg border border-line bg-paper p-3 text-sm"><strong>{balance} units remaining</strong>{inbound && <p className="mt-1">{decision === "REJECTED" ? "Dock rejection — do not put these goods in a warehouse bin." : `Putaway bin: ${binLabel(line.locations)}`}</p>}</div>}
      {serialWorkflowRequired && <WorkflowNotice notice={{ kind: "error", text: "Partial processing for serialized stock is not supported by the installed database workflow. Use the main order's serial processing panel for a full receipt/shipment. Do not process serialized stock as a standard item." }} />}
      {serialWorkflowRequired && <Link className="inline-flex min-h-11 items-center font-medium text-rack underline" href={`${inbound ? "/purchase-orders" : "/orders"}?q=${encodeURIComponent(order?.reference ?? "")}`}>Open serial processing</Link>}
      {missingBin && line && <WorkflowNotice notice={{ kind: "error", text: "This PO line has no receiving bin. Assign an active storage bin on the purchase order before accepting goods." }} />}
      <label className="block text-sm font-medium">{inbound && decision === "REJECTED" ? "Rejected units" : inbound ? "Units received now" : "Units shipped now"}<input type="number" required step="1" min="1" max={balance || 1} inputMode="numeric" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={!line || serialWorkflowRequired} className="input-field mt-1" placeholder="Count physical units" /></label>
      {inbound && decision === "REJECTED" && serialized && <SerialScanner key={lineId} label="Scan rejected serial numbers" serials={serials} onChange={setSerials} quantity={count} disabled={busy} />}
    </fieldset>
    <button disabled={busy || !ready} className="btn-primary mt-5 w-full justify-center sm:w-auto">{busy ? "Posting…" : inbound ? decision === "REJECTED" ? "Record dock rejection" : "Confirm receipt" : "Confirm partial shipment"}</button>
  </form>;
}
