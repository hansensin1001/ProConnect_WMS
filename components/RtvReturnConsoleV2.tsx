"use client";

import { FormEvent, useState } from "react";

type Product = { id: string; sku: string; name?: string | null };
type Bin = { id: string; location_code: string; display_code?: string | null };

export function RtvReturnConsoleV2({ orgId, products, bins }: { orgId: string; products: Product[]; bins: Bin[] }) {
  const [supplierName, setSupplierName] = useState("");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("DAMAGED");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, action: "createRtv", supplierName, lines: [{ productId, locationId, quantity: Number(quantity), reason }] }) });
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
    <p className="mt-1 text-sm text-graphite">RTVs are permitted only for accepted PO stock still available in a STORAGE (putaway) bin. Dock-rejected units cannot use RTV because they never entered warehouse inventory.</p>
    {message && <p role="alert" className="mt-4 rounded-md bg-paper px-3 py-2 text-sm text-alert">{message}</p>}
    <div className="mt-5 grid gap-4">
      <label className="block text-sm">Supplier name<input required value={supplierName} onChange={(event) => setSupplierName(event.target.value)} className="input-field mt-1" /></label>
      <label className="block text-sm">SKU<select required value={productId} onChange={(event) => setProductId(event.target.value)} className="input-field mt-1"><option value="">Select SKU…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku}{product.name ? ` — ${product.name}` : ""}</option>)}</select></label>
      <label className="block text-sm">Accepted putaway bin<select required value={locationId} onChange={(event) => setLocationId(event.target.value)} className="input-field mt-1"><option value="">Select STORAGE bin…</option>{bins.map((bin) => <option key={bin.id} value={bin.id}>{bin.display_code ?? bin.location_code}</option>)}</select></label>
      <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm">Return quantity<input required type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="input-field mt-1" /></label><label className="block text-sm">Reason<input required value={reason} onChange={(event) => setReason(event.target.value)} className="input-field mt-1" /></label></div>
    </div>
    <button disabled={busy} className="btn-danger mt-5">{busy ? "Creating…" : "Create RTV"}</button>
  </form>;
}
