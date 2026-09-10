"use client";

import { FormEvent, useMemo, useState } from "react";

type PurchaseOrderLine = {
  id: string;
  product_id: string;
  location_id: string;
  quantity_received: number;
  products?: { sku?: string; name?: string | null; is_serialized?: boolean } | null;
  locations?: { location_code?: string; display_code?: string | null } | null;
};
type PurchaseOrder = {
  id: string;
  po_number: string;
  supplier_name?: string | null;
  purchase_order_items?: PurchaseOrderLine[] | null;
};

function normalizeSerials(value: string) {
  return value.split(/[\n,;]+/).map((serial) => serial.trim().toUpperCase()).filter(Boolean);
}

export function RtvReturnConsoleV3({ orgId, purchaseOrders }: { orgId: string; purchaseOrders: PurchaseOrder[] }) {
  const [purchaseOrderId, setPurchaseOrderId] = useState("");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("DAMAGED");
  const [serialInput, setSerialInput] = useState("");
  const [returnSerials, setReturnSerials] = useState<string[]>([]);
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
  const selectedLine = useMemo(() => products.find((line) => line.product_id === productId), [products, productId]);
  const isSerialized = Boolean(selectedLine?.products?.is_serialized);
  const parsedQuantity = Number(quantity);

  function clearSerials() {
    setSerialInput("");
    setReturnSerials([]);
  }

  function addSerials(value = serialInput) {
    const additions = normalizeSerials(value);
    if (!additions.length) return;
    const existing = new Set(returnSerials.map((serial) => serial.toLowerCase()));
    const duplicate = additions.find((serial) => existing.has(serial.toLowerCase()));
    if (duplicate) {
      setMessage(`Serial ${duplicate} has already been scanned for this RTV.`);
      return;
    }
    setReturnSerials((current) => [...current, ...additions]);
    setSerialInput("");
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!purchaseOrder || !productId || !locationId || !Number.isInteger(parsedQuantity) || parsedQuantity < 1) {
      setMessage("Select an accepted purchase order, its received SKU, putaway bin, and quantity.");
      return;
    }
    if (isSerialized && returnSerials.length !== parsedQuantity) {
      setMessage(`Scan exactly ${parsedQuantity} unique serial number${parsedQuantity === 1 ? "" : "s"} before creating this RTV.`);
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
          lines: [{
            purchaseOrderId,
            productId,
            locationId,
            quantity: parsedQuantity,
            reason,
            serialNumbers: isSerialized ? returnSerials : [],
          }],
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to create the RTV.");
      setMessage("RTV created. It can be dispatched from the accepted putaway stock after review.");
      clearSerials();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create the RTV.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="max-w-2xl rounded-lg border border-line bg-panel p-6">
      <h2 className="font-semibold">Vendor return (RTV)</h2>
      <p className="mt-1 text-sm text-graphite">Only accepted PO stock in its original STORAGE bin can be returned. Serialized SKUs require exact in-stock serials from that PO and bin.</p>
      {message && <p role="alert" className="mt-4 rounded-md bg-paper px-3 py-2 text-sm text-alert">{message}</p>}
      {!purchaseOrders.length && <p className="mt-4 rounded-md border border-line p-3 text-sm text-graphite">There are no received purchase orders available for this organization.</p>}

      <div className="mt-5 grid gap-4">
        <label className="block text-sm">Accepted purchase order
          <select required value={purchaseOrderId} onChange={(event) => { setPurchaseOrderId(event.target.value); setProductId(""); setLocationId(""); clearSerials(); setMessage(""); }} className="input-field mt-1">
            <option value="">Select purchase order…</option>
            {purchaseOrders.map((order) => <option key={order.id} value={order.id}>{order.po_number}{order.supplier_name ? ` · ${order.supplier_name}` : ""}</option>)}
          </select>
        </label>
        <label className="block text-sm">Received SKU
          <select required value={productId} onChange={(event) => { setProductId(event.target.value); setLocationId(""); clearSerials(); }} disabled={!purchaseOrder} className="input-field mt-1">
            <option value="">Select SKU…</option>
            {products.map((line) => <option key={line.product_id} value={line.product_id}>{line.products?.sku ?? "SKU"}{line.products?.name ? ` — ${line.products.name}` : ""}{line.products?.is_serialized ? " · Serialized" : ""}</option>)}
          </select>
        </label>
        <label className="block text-sm">Original putaway bin
          <select required value={locationId} onChange={(event) => { setLocationId(event.target.value); clearSerials(); }} disabled={!productId} className="input-field mt-1">
            <option value="">Select received bin…</option>
            {productLines.map((line) => <option key={line.id} value={line.location_id}>{line.locations?.display_code ?? line.locations?.location_code ?? "Putaway bin"} · {line.quantity_received} accepted</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm">Return quantity<input required type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="input-field mt-1" /></label>
          <label className="block text-sm">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} className="input-field mt-1" /></label>
        </div>

        {isSerialized && (
          <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div><p className="text-sm font-medium text-violet-900">Vendor-return serial validation</p><p className="mt-1 text-xs text-violet-800">Scan serials received on this PO and still held in the selected putaway bin.</p></div>
              <span className={`rounded-full px-2 py-1 text-xs font-semibold ${returnSerials.length === parsedQuantity ? "bg-emerald-100 text-go" : "bg-amber/20 text-amber-dark"}`}>{returnSerials.length} / {Number.isInteger(parsedQuantity) ? parsedQuantity : 0} scanned</span>
            </div>
            <div className="mt-3 flex gap-2">
              <input value={serialInput} onChange={(event) => setSerialInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSerials(); } }} placeholder="Scan serial then press Enter" className="input-field" />
              <button type="button" onClick={() => addSerials()} className="btn-secondary">Add</button>
            </div>
            {returnSerials.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{returnSerials.map((serial) => <span key={serial} className="inline-flex items-center gap-2 rounded bg-panel px-2 py-1 text-xs ring-1 ring-inset ring-violet-200"><span className="code-label">{serial}</span><button type="button" onClick={() => setReturnSerials((current) => current.filter((item) => item !== serial))} className="text-alert" aria-label={`Remove ${serial}`}>×</button></span>)}</div>}
          </section>
        )}
      </div>
      <button disabled={busy || !purchaseOrders.length || (isSerialized && returnSerials.length !== parsedQuantity)} className="btn-danger mt-5">{busy ? "Creating…" : "Create RTV"}</button>
    </form>
  );
}
