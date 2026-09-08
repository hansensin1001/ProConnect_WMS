"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileUp, Plus, ScanLine, Trash2, Truck } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageNavigation } from "@/components/ui/PageNavigation";
import { RowActions } from "@/components/ui/RowActions";
import { readSerialImport, splitSerialInput } from "@/lib/serial-import";
import { createClient } from "@/lib/supabase/client";

type Line = { productId: string; locationId: string; quantity: number };
type ReceiptLine = { id: string; product_id: string; location_id: string; quantity_expected: number; quantity_received: number };
type Product = { id: string; sku: string; name: string; is_serialized: boolean };
type Location = { id: string; display_code?: string; location_code: string };
type Order = { id: string; po_number: string; supplier_name: string | null; status: string; created_at: string; purchase_order_items?: ReceiptLine[] };
type ReceivedSerial = { id: string; serial_number: string; status: string; received_at: string; locations?: { display_code?: string; location_code: string } | null; products?: { sku: string; name: string } | null };

export function PurchaseOrderManager({ orgId, canManage, initialOrders, products, locations, page, total }: { orgId: string; canManage: boolean; initialOrders: Order[]; products: Product[]; locations: Location[]; page: number; total: number }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState(initialOrders);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [viewing, setViewing] = useState<Order | null>(null);
  const [viewSerials, setViewSerials] = useState<ReceivedSerial[]>([]);
  const [viewSerialsLoading, setViewSerialsLoading] = useState(false);
  const [receiving, setReceiving] = useState<Order | null>(null);
  const [supplier, setSupplier] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", locationId: "", quantity: 1 }]);
  const [receiptSerials, setReceiptSerials] = useState<Record<string, string[]>>({});
  const [scanValues, setScanValues] = useState<Record<string, string>>({});
  const [importingLine, setImportingLine] = useState<string | null>(null);
  const [receivingBusy, setReceivingBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const locationsById = useMemo(() => new Map(locations.map((location) => [location.id, location])), [locations]);

  useEffect(() => setOrders(initialOrders), [initialOrders]);
  const productFor = (productId: string) => productsById.get(productId);
  const isSerializedLine = (line: ReceiptLine) => Boolean(productFor(line.product_id)?.is_serialized);

  function beginCreate() {
    setEditing(null); setSupplier(""); setLines([{ productId: "", locationId: "", quantity: 1 }]); setMsg(""); setOpen(true);
  }
  function beginEdit(order: Order) {
    setEditing(order); setSupplier(order.supplier_name ?? "");
    setLines((order.purchase_order_items ?? []).map((line) => ({ productId: line.product_id, locationId: line.location_id, quantity: line.quantity_expected })));
    setMsg(""); setOpen(true);
  }
  async function beginView(order: Order) {
    setViewing(order); setViewSerials([]); setMsg(""); setViewSerialsLoading(true);
    try {
      const { data, error } = await (supabase.from("serial_numbers") as any)
        .select("id, serial_number, status, received_at, locations(location_code, display_code), products(sku, name)")
        .eq("org_id", orgId)
        .eq("purchase_order_id", order.id)
        .order("received_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      setViewSerials(data ?? []);
    } catch (error) { setMsg(error instanceof Error ? error.message : "Unable to load received serial numbers."); }
    finally { setViewSerialsLoading(false); }
  }
  function beginReceive(order: Order) {
    const initial: Record<string, string[]> = {};
    (order.purchase_order_items ?? []).forEach((line) => { if (isSerializedLine(line)) initial[line.id] = []; });
    setReceiptSerials(initial); setScanValues({}); setMsg(""); setReceiving(order);
  }
  function updateLine(index: number, patch: Partial<Line>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); }

  function addSerials(line: ReceiptLine, values: string[]) {
    if (!receiving || !values.length) return;
    const existingElsewhere = new Set(Object.entries(receiptSerials).filter(([lineId]) => lineId !== line.id).flatMap(([, serials]) => serials));
    const current = receiptSerials[line.id] ?? [];
    const next = [...current];
    for (const serial of values) {
      if (existingElsewhere.has(serial) || next.includes(serial)) { setMsg(`Serial ${serial} was already added to this receipt.`); continue; }
      if (next.length >= line.quantity_expected) { setMsg(`This line requires exactly ${line.quantity_expected} serial numbers.`); break; }
      next.push(serial);
    }
    setReceiptSerials((state) => ({ ...state, [line.id]: next }));
  }
  function handleScanChange(line: ReceiptLine, value: string) {
    if (/[\n,;\t]/.test(value)) { addSerials(line, splitSerialInput(value)); setScanValues((state) => ({ ...state, [line.id]: "" })); }
    else setScanValues((state) => ({ ...state, [line.id]: value }));
  }
  function commitScan(line: ReceiptLine) {
    const value = scanValues[line.id] ?? "";
    addSerials(line, splitSerialInput(value));
    setScanValues((state) => ({ ...state, [line.id]: "" }));
  }
  async function importSerialFile(line: ReceiptLine, file: File | null) {
    if (!file) return;
    setImportingLine(line.id);
    try { addSerials(line, await readSerialImport(file)); }
    catch (error) { setMsg(error instanceof Error ? error.message : "Unable to import serial numbers."); }
    finally { setImportingLine(null); }
  }
  function removeSerial(lineId: string, serial: string) { setReceiptSerials((state) => ({ ...state, [lineId]: (state[lineId] ?? []).filter((value) => value !== serial) })); }
  function receiptReady() {
    if (!receiving) return false;
    return (receiving.purchase_order_items ?? []).every((line) => !isSerializedLine(line) || (receiptSerials[line.id] ?? []).length === line.quantity_expected);
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    const valid = lines.filter((line) => line.productId && line.locationId && line.quantity > 0);
    if (!supplier.trim() || !valid.length) return setMsg("Add a supplier, SKU, receiving bin, and quantity.");
    try {
      const response = await fetch("/api/purchase-orders", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editing ? { orgId, orderId: editing.id, action: "update", supplierName: supplier, lines: valid } : { orgId, supplierName: supplier, lines: valid }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to save purchase order.");
      if (editing) router.refresh(); else setOrders((current) => [payload.order, ...current]);
      setOpen(false);
    } catch (error) { setMsg(error instanceof Error ? error.message : "Unable to save purchase order."); }
  }
  async function action(order: Order, actionName: "rollback") {
    try {
      const response = await fetch("/api/purchase-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, orderId: order.id, action: actionName }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to update purchase order.");
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status: order.status === "PENDING" ? "CANCELLED" : "REVERTED" } : item));
    } catch (error) { setMsg(error instanceof Error ? error.message : "Unable to update purchase order."); }
  }
  async function receiveStock() {
    if (!receiving || !receiptReady()) return;
    setReceivingBusy(true); setMsg("");
    try {
      const serials = Object.entries(receiptSerials).flatMap(([purchaseOrderItemId, values]) => values.map((serialNumber) => ({ purchaseOrderItemId, serialNumber })));
      const response = await fetch("/api/purchase-orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, orderId: receiving.id, action: "receive", serials }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to receive purchase order.");
      setOrders((current) => current.map((order) => order.id === receiving.id ? { ...order, status: "RECEIVED", purchase_order_items: order.purchase_order_items?.map((line) => ({ ...line, quantity_received: line.quantity_expected })) } : order));
      setReceiving(null); router.refresh();
    } catch (error) { setMsg(error instanceof Error ? error.message : "Unable to receive purchase order."); }
    finally { setReceivingBusy(false); }
  }

  return <div className="space-y-4">
    <div className="flex justify-end">{canManage && <button onClick={beginCreate} className="btn-primary"><Plus size={16} />Create purchase order</button>}</div>
    {msg && <p role="alert" className="text-sm text-alert">{msg}</p>}
    <div className="overflow-hidden rounded-lg border border-line bg-panel"><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-5 py-3">PO reference</th><th className="px-5 py-3">Supplier</th><th className="px-5 py-3">Lines</th><th className="px-5 py-3">Status</th><th className="px-5 py-3" /></tr></thead><tbody>{orders.map((order) => { const received = ["RECEIVED", "COMPLETED"].includes(order.status); return <tr key={order.id} className="border-t border-line hover:bg-paper/70"><td className="px-5 py-3"><button onClick={() => beginView(order)} className="code-label font-medium text-rack hover:underline">{order.po_number}</button></td><td className="px-5 py-3">{order.supplier_name ?? "—"}</td><td className="px-5 py-3">{order.purchase_order_items?.length ?? 0}</td><td className="px-5 py-3"><StatusBadge status={received ? "ACTIVE" : order.status} /></td><td className="px-5 py-3"><RowActions onView={() => beginView(order)} onEdit={canManage && ["DRAFT", "PENDING"].includes(order.status) ? () => beginEdit(order) : undefined} extraActions={canManage ? [...(order.status === "PENDING" ? [{ label: "Process receipt", onClick: () => beginReceive(order) }] : []), ...((order.status === "PENDING" || received) ? [{ label: order.status === "PENDING" ? "Cancel PO" : "Rollback receipt", onClick: () => action(order, "rollback"), destructive: true }] : [])] : []} /></td></tr>; })}</tbody></table></div><PageNavigation page={page} pageSize={50} total={total} /></div>

    <Drawer open={open} onClose={() => setOpen(false)} title={editing ? "Edit purchase order" : "Create purchase order"} description="Inbound stock changes only when the PO is received."><form onSubmit={save} className="space-y-5"><label className="block text-sm">Supplier<input value={supplier} onChange={(event) => setSupplier(event.target.value)} required className="input-field mt-1" /></label><div><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Expected receipts</p><div className="mt-3 space-y-3">{lines.map((line, index) => <div key={index} className="grid gap-2 md:grid-cols-[1fr_1fr_90px]"><select value={line.productId} onChange={(event) => updateLine(index, { productId: event.target.value })} className="input-field"><option value="">Master SKU…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}{product.is_serialized ? " · Serialized" : ""}</option>)}</select><select value={line.locationId} onChange={(event) => updateLine(index, { locationId: event.target.value })} className="input-field"><option value="">Receiving bin…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.display_code ?? "LOC?"} · {location.location_code}</option>)}</select><input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} className="input-field" /></div>)}</div><button type="button" onClick={() => setLines((current) => [...current, { productId: "", locationId: "", quantity: 1 }])} className="btn-secondary mt-3">Add line</button></div><div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" onClick={() => setOpen(false)} className="btn-secondary">Cancel</button><button className="btn-primary"><Truck size={16} />{editing ? "Save PO" : "Create PO"}</button></div></form></Drawer>

    <Drawer open={viewing !== null} onClose={() => setViewing(null)} title="Purchase order details" description={viewing?.po_number}>
      {viewing && <div className="space-y-6">
        <dl className="grid grid-cols-2 gap-4 text-sm"><div><dt className="text-graphite">Supplier</dt><dd className="mt-1 font-medium">{viewing.supplier_name ?? "—"}</dd></div><div><dt className="text-graphite">Status</dt><dd className="mt-1"><StatusBadge status={["RECEIVED", "COMPLETED"].includes(viewing.status) ? "ACTIVE" : viewing.status} /></dd></div><div className="col-span-2"><dt className="text-graphite">Created date & time</dt><dd className="mt-1 font-medium">{new Date(viewing.created_at).toLocaleString()}</dd></div></dl>
        <section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Purchase order lines</p><div className="mt-2 overflow-hidden rounded-md border border-line"><table className="w-full text-sm"><thead className="bg-paper text-left text-xs text-graphite"><tr><th className="px-4 py-3">SKU / product</th><th className="px-4 py-3">Receiving bin</th><th className="px-4 py-3 text-right">Expected</th><th className="px-4 py-3 text-right">Received</th></tr></thead><tbody>{(viewing.purchase_order_items ?? []).map((line) => { const product = productFor(line.product_id); const location = locationsById.get(line.location_id); return <tr key={line.id} className="border-t border-line"><td className="px-4 py-3"><span className="code-label">{product?.sku ?? "SKU"}</span><span className="ml-2">{product?.name ?? "Product unavailable"}</span>{product?.is_serialized && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Serialized</span>}</td><td className="px-4 py-3 code-label">{location ? `${location.display_code ?? "LOC?"} · ${location.location_code}` : "Location unavailable"}</td><td className="px-4 py-3 text-right">{line.quantity_expected}</td><td className="px-4 py-3 text-right">{line.quantity_received}</td></tr>; })}</tbody></table></div></section>
        <section><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Received serial numbers</p><span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">{viewSerials.length} registered</span></div><div className="mt-2 rounded-md border border-line bg-paper p-3">{viewSerialsLoading ? <p className="text-sm text-graphite">Loading registered serial numbers…</p> : viewSerials.length ? <div className="space-y-2">{viewSerials.map((serial) => <div key={serial.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-panel px-3 py-2 text-sm"><span><span className="code-label font-medium">{serial.serial_number}</span><span className="ml-2 text-graphite">{serial.products?.sku ?? "SKU"} · {serial.products?.name ?? "Product"}</span></span><span className="text-xs text-graphite">{serial.locations?.display_code ?? serial.locations?.location_code ?? "Unknown bin"} · {serial.status}</span></div>)}</div> : <p className="text-sm text-graphite">No serial numbers were registered for this purchase order.</p>}</div></section>
      </div>}
    </Drawer>

    <Drawer open={receiving !== null} onClose={() => !receivingBusy && setReceiving(null)} title="Process purchase receipt" description={receiving ? `${receiving.po_number} · serialised lines must match the received quantity exactly` : undefined}>{receiving && <div className="space-y-5"><section className="rounded-md border border-line bg-paper p-3 text-sm"><p className="font-medium">{receiving.supplier_name ?? "Supplier"}</p><p className="mt-1 text-xs text-graphite">Scan each serial into its matching SKU line. CSV, TXT, and standard .xlsx files import the first column.</p></section>{(receiving.purchase_order_items ?? []).map((line) => { const product = productFor(line.product_id); const location = locationsById.get(line.location_id); const serials = receiptSerials[line.id] ?? []; if (!product?.is_serialized) return <div key={line.id} className="rounded-md border border-line p-4 text-sm"><div className="flex justify-between gap-3"><span><span className="code-label">{product?.sku ?? "SKU"}</span><span className="ml-2">{product?.name ?? "Product unavailable"}</span></span><span>{line.quantity_expected} units → {location?.display_code ?? location?.location_code ?? "Bin"}</span></div><p className="mt-2 text-xs text-graphite">Standard SKU — no serial registration required.</p></div>; return <section key={line.id} className="rounded-lg border border-violet-200 bg-violet-50/40 p-4"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium"><span className="code-label">{product.sku}</span><span className="ml-2">{product.name}</span></p><p className="mt-1 text-xs text-graphite">Receive {line.quantity_expected} into {location?.display_code ?? location?.location_code ?? "selected bin"}</p></div><span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${serials.length === line.quantity_expected ? "bg-emerald-100 text-go" : "bg-amber/20 text-amber-dark"}`}>{serials.length} / {line.quantity_expected} scanned</span></div><div className="mt-4 flex gap-2"><div className="relative flex-1"><ScanLine size={16} className="absolute left-3 top-3 text-graphite" /><input value={scanValues[line.id] ?? ""} onChange={(event) => handleScanChange(line, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitScan(line); } }} placeholder="Scan serial, then press Enter" className="input-field pl-9" /></div><button type="button" onClick={() => commitScan(line)} className="btn-secondary">Add</button><label className="btn-secondary cursor-pointer"><FileUp size={16} />{importingLine === line.id ? "Importing…" : "Import"}<input type="file" accept=".csv,.txt,.xlsx" disabled={importingLine !== null} onChange={(event) => void importSerialFile(line, event.target.files?.[0] ?? null)} className="sr-only" /></label></div>{serials.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{serials.map((serial) => <span key={serial} className="inline-flex items-center gap-1 rounded bg-panel px-2 py-1 text-xs code-label"><span>{serial}</span><button type="button" onClick={() => removeSerial(line.id, serial)} aria-label={`Remove ${serial}`} className="text-alert"><Trash2 size={13} /></button></span>)}</div>}</section>; })}{msg && <p role="alert" className="text-sm text-alert">{msg}</p>}<div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" disabled={receivingBusy} onClick={() => setReceiving(null)} className="btn-secondary">Cancel</button><button type="button" disabled={!receiptReady() || receivingBusy} onClick={() => void receiveStock()} className="btn-primary"><Truck size={16} />{receivingBusy ? "Receiving…" : "Receive stock"}</button></div></div>}</Drawer>
  </div>;
}
