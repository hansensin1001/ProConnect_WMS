"use client";

import { FormEvent, useMemo, useState } from "react";

type PurchaseOrderLine = {
  id: string;
  product_id: string;
  location_id: string;
  quantity_received: number;
  products?: { sku?: string; name?: string | null } | null;
  locations?: { location_code?: string; display_code?: string | null } | null;
};
type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_name?: string | null;
  purchase_order_items?: PurchaseOrderLine[] | null;
};

export function RtvReturnConsoleV2({ orgId, purchaseOrders }: { orgId: string; purchaseOrders: PurchaseOrder[] }) {
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("DAMAGED");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const purchaseOrder = useMemo(() => purchaseOrders.find((item) => item.id === purchaseOrderId), [purchaseOrders, purchaseOrderId]);
  const receivedLines = useMemo(() => (purchaseOrder?.purchase_order_items ?? []).filter((item) => item.quantity_received > 0), [purchaseOrder]);
  const productLines = useMemo(() => receivedLines.filter((item) => item.product_id === productId), [receivedLines, productId]);
  const products = useMemo(() => {
    const unique = new Map<string, PurchaseOrderLine>();
    for (const line of receivedLines) unique.set(line.product_id, line);
    return [...unique.values()];
  }, [receivedLines]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsedQuantity = Number(quantity);
    if (!purchaseOrder || !productId || !locationId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      setMessage("Select an accepted purchase order, its received SKU, putaway bin, and quantity.");
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
          action: "createRtv",
          supplierName: purchaseOrder.supplier_name ?? "Supplier",
          lines: [{ purchaseOrderId, productId, locationId, quantity: parsedQuantity, reason }],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to create the RTV.");
      setMessage("RTV created. It can be dispatched from the accepted putaway stock after review.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create the RTV.");
    } finally {
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="max-w-2xl rounded-lg border border-line bg-panel p-6">
    <h2 className="font-semibold">Vendor return (RTV)</h2>
    <p className="mt-1 text-sm text-graphite">Select the PO that originally accepted the stock. Only received stock still available in that PO&apos;s STORAGE (putaway) bin can be returned.</p>
    {message && <p role="alert" className="mt-4 rounded-md bg-paper px-3 py-2 text-sm text-alert">{message}</p>}
    {!purchaseOrders.length && <p className="mt-4 rounded-md border border-line p-3 text-sm text-graphite">There are no received purchase orders available for this organization.</p>}
    <div className="mt-5 grid gap-4">
      <label className="block text-sm">Accepted purchase order
        <select required value={purchaseOrderId} onChange={(event) => { setPurchaseOrderId(event.target.value); setProductId(""); setLocationId(""); setMessage(""); }} className="input-field mt-1">
          <option value="">Select purchase order…</option>
          {purchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.po_number}{order.supplier_name ? ` · ${order.supplier_name}` : ""}</option>)}
        </select>
      </label>
      <label className="block text-sm">Received SKU
        <select required value={productId} onChange={(event) => { setProductId(event.target.value); setLocationId(""); }} disabled={!purchaseOrder} className="input-field mt-1">
          <option value="">Select SKU…</option>
          {products.map((line) => <option key={line.product_id} value={line.product_id}>{line.products?.sku ?? "SKU"}{line.products?.name ? ` — ${line.products.name}` : ""}</option>)}
        </select>
      </label>
      <label className="block text-sm">Original putaway bin
        <select required value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={!productId} className="input-field mt-1">
          <option value="">Select received bin…</option>
          {productLines.map((line) => <option key={line.id} value={line.location_id}>{line.locations?.display_code ?? line.locations?.location_code ?? "Putaway bin"} · {line.quantity_received} accepted</option>)}
        </select>
      </label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Return quantity<input required type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="input-field mt-1" /></label><label className="block text-sm">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} className="input-field mt-1" /></label></div>
    </div>
    <button disabled={busy || !purchaseOrders.length} className="btn-danger mt-5">{busy ? "Creating…" : "Create RTV"}</button>
  </form>;
}
