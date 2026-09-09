"use client";

import { FormEvent, useMemo, useState } from "react";

type PurchaseOrderLine = {
  id: string;
  quantity_expected: number;
  quantity_received: number;
  rejected_qty?: number;
  remaining_qty?: number;
  products?: { sku?: string; name?: string; is_serialized?: boolean | null } | null;
};
type PurchaseOrder = { id: string; po_number: string; purchase_order_items?: PurchaseOrderLine[] | null };

function serialList(value: string) {
  return value.split(/[\n,;]+/).map((serial) => serial.trim()).filter(Boolean);
}

export function PartialReceiptConsoleV2({ orgId, orders }: { orgId: string; orders: PurchaseOrder[] }) {
  const [orderId, setOrderId] = useState("");
  const [lineId, setLineId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [disposition, setDisposition] = useState<"AVAILABLE" | "REJECTED">("AVAILABLE");
  const [rejectedSerials, setRejectedSerials] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const order = useMemo(() => orders.find((item) => item.id === orderId), [orders, orderId]);
  const line = useMemo(() => order?.purchase_order_items?.find((item) => item.id === lineId), [order, lineId]);
  const remaining = line?.remaining_qty ?? Math.max(0, (line?.quantity_expected ?? 0) - (line?.quantity_received ?? 0) - (line?.rejected_qty ?? 0));
  const isSerialized = Boolean(line?.products?.is_serialized);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    if (!lineId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > remaining) {
      setMessage("Enter a quantity within the remaining PO balance.");
      return;
    }
    const serials = serialList(rejectedSerials);
    if (disposition === "REJECTED" && isSerialized && serials.length !== parsedQuantity) {
      setMessage("Enter exactly one rejected serial number for each rejected serialized unit.");
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/exceptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "partialReceipt",
          orderId,
          receipts: [{ purchaseOrderItemId: lineId, quantity: parsedQuantity, disposition, rejectedSerials: disposition === "REJECTED" ? serials : [] }],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to post the receipt.");
      setMessage(disposition === "REJECTED"
        ? "Rejected at Receiving recorded. No inventory or quarantine balance was created."
        : "Accepted receipt posted to the PO bin. The order stays open only for its unresolved balance.");
      setRejectedSerials("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to post the receipt.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="max-w-2xl rounded-lg border border-line bg-panel p-6">
    <h2 className="font-semibold">Receive purchase order</h2>
    <p className="mt-1 text-sm text-graphite">Accept usable units into the line&apos;s putaway bin, or reject damaged units at the dock. Dock rejections never create inventory.</p>
    {message && <p role="alert" className="mt-4 rounded-md bg-paper px-3 py-2 text-sm text-alert">{message}</p>}
    <div className="mt-5 grid gap-4">
      <label className="block text-sm">Purchase order
        <select required value={orderId} onChange={(event) => { setOrderId(event.target.value); setLineId(""); setMessage(""); }} className="input-field mt-1">
          <option value="">Select open purchase order…</option>
          {orders.map((item) => <option key={item.id} value={item.id}>{item.po_number}</option>)}
        </select>
      </label>
      <label className="block text-sm">Purchase order line
        <select required value={lineId} onChange={(event) => { setLineId(event.target.value); setMessage(""); }} className="input-field mt-1" disabled={!order}>
          <option value="">Select line…</option>
          {(order?.purchase_order_items ?? []).map((item) => {
            const lineRemaining = item.remaining_qty ?? Math.max(0, item.quantity_expected - item.quantity_received - (item.rejected_qty ?? 0));
            return <option key={item.id} value={item.id}>{item.products?.sku ?? "SKU"} · remaining {lineRemaining}</option>;
          })}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">Quantity
          <input required type="number" min="1" max={Math.max(1, remaining)} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="input-field mt-1" disabled={!line} />
          {line && <span className="mt-1 block text-xs text-graphite">{remaining} unit{remaining === 1 ? "" : "s"} unresolved</span>}
        </label>
        <label className="block text-sm">Receiving decision
          <select value={disposition} onChange={(event) => setDisposition(event.target.value as "AVAILABLE" | "REJECTED")} className="input-field mt-1" disabled={!line}>
            <option value="AVAILABLE">Accept into putaway inventory</option>
            <option value="REJECTED">Reject at receiving (damaged)</option>
          </select>
        </label>
      </div>
      {disposition === "REJECTED" && <label className="block text-sm">Rejected serial numbers {isSerialized ? <span className="text-alert">(required: one per unit)</span> : <span className="text-graphite">(optional)</span>}
        <textarea value={rejectedSerials} onChange={(event) => setRejectedSerials(event.target.value)} placeholder="One serial per line, or separate with commas" className="input-field mt-1 min-h-24" />
      </label>}
    </div>
    <button disabled={busy || !line} className="btn-primary mt-5">{busy ? "Saving…" : disposition === "REJECTED" ? "Record dock rejection" : "Confirm receipt"}</button>
  </form>;
}
