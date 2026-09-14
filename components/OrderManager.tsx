"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { WorkflowNotice } from "@/components/ui/WorkflowNotice";
import { appendSerials, binLabel } from "@/lib/warehouse-ui";
import { Plus, Printer, ScanLine, Trash2, Truck } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageNavigation } from "@/components/ui/PageNavigation";
import { splitSerialInput } from "@/lib/serial-import";
import { createClient } from "@/lib/supabase/client";

type Product = { id: string; sku: string; name: string; unit_of_measure: string; is_serialized: boolean };
type Line = { productId: string; quantity: number };
type Header = { customerName: string; platform: string; shippingAddress: string; shippingCity: string; shippingPostcode: string };
type OrderLine = { id: string; product_id: string; quantity_requested: number; quantity_picked: number; quantity_reserved?: number };
type Order = { id: string; order_number: string; platform: string; customer_name: string | null; shipping_address?: string | null; shipping_city?: string | null; shipping_postcode?: string | null; status: string; created_at: string; carrier_id?: string | null; carrier_service?: string | null; tracking_number?: string | null; carrier_status?: string | null; order_items?: OrderLine[] };
type ProcessLine = OrderLine & { products?: Product; order_item_allocations?: { quantity_reserved: number; quantity_fulfilled?: number; picking_location?: { display_code?: string; location_code: string }; inventory_balances?: { location_id: string; locations?: { display_code?: string; location_code: string } } }[] };
type ProcessOrder = Omit<Order, "order_items"> & { order_items?: ProcessLine[] };
type SerialOption = { serial_number: string; product_id: string; location_id: string };
type PickingLocation = { id: string; code: string };
type DispatchedSerial = { id: string; serial_number: string; status: string; shipped_at: string | null; locations?: { display_code?: string; location_code: string } | null; products?: { sku: string; name: string } | null };

const emptyHeader: Header = { customerName: "", platform: "MANUAL", shippingAddress: "", shippingCity: "", shippingPostcode: "" };

export function OrderManager({ orgId, orgName, canManage, initialOrders, products, page, total }: { orgId: string; orgName: string; canManage: boolean; initialOrders: Order[]; products: Product[]; page: number; total: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [orders, setOrders] = useState(initialOrders);
  const [drawer, setDrawer] = useState<"create" | "view" | "edit" | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [dispatchedSerials, setDispatchedSerials] = useState<DispatchedSerial[]>([]);
  const [dispatchedSerialsLoading, setDispatchedSerialsLoading] = useState(false);
  const [processing, setProcessing] = useState<Order | null>(null);
  const [processDetails, setProcessDetails] = useState<ProcessOrder | null>(null);
  const [serialOptions, setSerialOptions] = useState<SerialOption[]>([]);
  const [pickingLocations, setPickingLocations] = useState<PickingLocation[]>([]);
  const [pickingLocationId, setPickingLocationId] = useState("");
  const [serialsTruncated, setSerialsTruncated] = useState(false);
  const [shipmentSerials, setShipmentSerials] = useState<Record<string, string[]>>({});
  const [scanValues, setScanValues] = useState<Record<string, string>>({});
  const [verifyingSerials, setVerifyingSerials] = useState<Record<string, boolean>>({});
  const [processingLoading, setProcessingLoading] = useState(false);
  const [processingBusy, setProcessingBusy] = useState(false);
  const [reprintingOrderId, setReprintingOrderId] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: 1 }]);
  const [header, setHeader] = useState<Header>(emptyHeader);
  const [message, setMessage] = useState("");
  const [scanBlocked, setScanBlocked] = useState(false);
  const [barcodeChecks, setBarcodeChecks] = useState<Record<string, boolean>>({});
  const [carriers, setCarriers] = useState<{id:string; display_name:string; is_active:boolean}[]>([]);
  const [carrierId, setCarrierId] = useState("");
  const [weight, setWeight] = useState("");
  const serialState = useRef(shipmentSerials);
  serialState.current = shipmentSerials;
  const scanQueue = useRef(Promise.resolve());
  const pendingScans = useRef(0);
  const processVersion = useRef(0);
  const shipmentLock = useRef(false);
  const [pendingScanCount, setPendingScanCount] = useState(0);
  const scanInputs = useRef<Record<string, HTMLInputElement | null>>({});
  useEffect(() => { if (processDetails?.status === "ALLOCATED") Object.values(scanInputs.current)[0]?.focus(); }, [processDetails]);

  useEffect(() => setOrders(initialOrders), [initialOrders]);
  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const productFor = (id: string) => productsById.get(id);
  const editable = selected?.status === "NEW" || selected?.status === "DRAFT";

  function updateHeader(key: keyof Header, value: string) { setHeader((current) => ({ ...current, [key]: value })); }
  function updateLine(index: number, patch: Partial<Line>) { setLines((current) => current.map((line, i) => i === index ? { ...line, ...patch } : line)); }
  function openCreate() { setHeader(emptyHeader); setLines([{ productId: "", quantity: 1 }]); setStep(1); setSelected(null); setMessage(""); setDrawer("create"); }
  async function openView(order: Order) {
    setSelected(order); setDispatchedSerials([]); setMessage(""); setDrawer("view"); setDispatchedSerialsLoading(true);
    try {
      const { data, error } = await (supabase.from("serial_numbers") as any)
        .select("id, serial_number, status, shipped_at, locations(location_code, display_code), products(sku, name)")
        .eq("org_id", orgId)
        .eq("sales_order_id", order.id)
        .eq("status", "SHIPPED")
        .order("shipped_at", { ascending: true })
        .limit(500);
      if (error) throw error;
      setDispatchedSerials(data ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load dispatched serial numbers."); }
    finally { setDispatchedSerialsLoading(false); }
  }
  function openEdit(order: Order) { setSelected(order); setHeader({ customerName: order.customer_name ?? "", platform: order.platform ?? "MANUAL", shippingAddress: order.shipping_address ?? "", shippingCity: order.shipping_city ?? "", shippingPostcode: order.shipping_postcode ?? "" }); setLines((order.order_items ?? []).map((line) => ({ productId: line.product_id, quantity: line.quantity_requested }))); setMessage(""); setDrawer("edit"); }
  function validLines() { return lines.filter((line) => line.productId && Number.isInteger(line.quantity) && line.quantity > 0); }
  function payload(extra: Record<string, unknown> = {}) { return { orgId, customerName: header.customerName, platform: header.platform, shippingAddress: header.shippingAddress, shippingCity: header.shippingCity, shippingPostcode: header.shippingPostcode, lines: validLines(), ...extra }; }

  async function createOrder(event: FormEvent) {
    event.preventDefault(); if (!validLines().length || validLines().length !== lines.length) return setMessage("Add at least one product and quantity.");
    try { const response = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload()) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to create the sales order."); setOrders((current) => [result.order, ...current]); setDrawer(null); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to create the sales order."); }
  }
  async function saveOrder(event: FormEvent) {
    event.preventDefault(); if (!selected || !validLines().length || validLines().length !== lines.length) return setMessage("Add at least one product and quantity.");
    try { const response = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload({ orderId: selected.id, action: "update" })) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to save this order."); const updated = { ...selected, customer_name: header.customerName, platform: header.platform, shipping_address: header.shippingAddress, shipping_city: header.shippingCity, shipping_postcode: header.shippingPostcode, order_items: lines.map((line, index) => ({ id: `${selected.id}-${index}`, product_id: line.productId, quantity_requested: line.quantity, quantity_picked: 0 })) }; setOrders((current) => current.map((order) => order.id === selected.id ? updated : order)); setSelected(updated); setDrawer("view"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save this order."); }
  }
  async function apiTransition(order: Order, status: "ALLOCATED" | "SHIPPED", serials: { orderItemId: string; serialNumber: string }[] = [], selectedPickingLocationId = "") {
    const response = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, orderId: order.id, status, serials, pickingLocationId: selectedPickingLocationId || null }) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to update this order.");
    const changed = { ...order, status }; setOrders((current) => current.map((item) => item.id === order.id ? changed : item)); setSelected((current) => current?.id === order.id ? changed : current); return changed;
  }
  async function rollback(order: Order) { try { const response = await fetch("/api/orders", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, orderId: order.id, action: "rollback" }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to roll back this order."); const changed = { ...order, status: "REVERTED" }; setOrders((current) => current.map((item) => item.id === order.id ? changed : item)); setSelected((current) => current?.id === order.id ? changed : current); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to roll back this order."); } }
  async function remove(id: string) { try { const response = await fetch(`/api/orders?orgId=${encodeURIComponent(orgId)}&orderId=${encodeURIComponent(id)}`, { method: "DELETE" }); const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Unable to delete this order."); setOrders((current) => current.filter((item) => item.id !== id)); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete this order."); } }
  async function reprintAwb(order: Order) {
    if (!order.tracking_number) return setMessage("An AWB has not been generated for this sales order yet.");
    if (reprintingOrderId) return;
    // Open the tab during the click gesture so browser pop-up protection does
    // not prevent the printable label from appearing after the API call.
    const labelWindow = window.open("", "_blank");
    if (labelWindow) labelWindow.opener = null;
    setReprintingOrderId(order.id); setMessage("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(order.id)}/shipping-label`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to prepare the AWB for printing.");
      const labelUrl = result.labelUrl ?? `/api/orders/${encodeURIComponent(order.id)}/shipping-label`;
      if (labelWindow) labelWindow.location.href = labelUrl;
      else window.open(labelUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      labelWindow?.close();
      setMessage(error instanceof Error ? error.message : "Unable to prepare the AWB for printing.");
    } finally { setReprintingOrderId(null); }
  }

  async function openProcessing(order: Order) {
    const version = ++processVersion.current;
    setScanBlocked(false); setBarcodeChecks({}); serialState.current = {}; setCarrierId(""); setCarriers([]); setWeight("");
    setProcessing(order); setProcessDetails(null); setSerialOptions([]); setPickingLocations([]); setPickingLocationId(""); setShipmentSerials({}); setScanValues({}); setVerifyingSerials({}); setMessage(""); setProcessingLoading(true);
    try {
      const response = await fetch(`/api/orders/serial-options?orgId=${encodeURIComponent(orgId)}&orderId=${encodeURIComponent(order.id)}`);
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to load shipment details.");
      if (version !== processVersion.current) return;
      setProcessDetails(payload.order); setSerialOptions(payload.serials ?? []); setPickingLocations(payload.pickingLocations ?? []); setPickingLocationId(payload.pickingLocations?.[0]?.id ?? ""); setSerialsTruncated(Boolean(payload.truncated));
      const initial: Record<string, string[]> = {}; (payload.order.order_items ?? []).forEach((line: ProcessLine) => { if (line.products?.is_serialized) initial[line.id] = []; }); setShipmentSerials(initial);
      if (order.status === "ALLOCATED") {
        const carrierResponse = await fetch(`/api/carriers?orgId=${encodeURIComponent(orgId)}`);
        const carrierResult = await carrierResponse.json();
        if (version !== processVersion.current) return;
        if (!carrierResponse.ok) throw new Error(carrierResult.error ?? "Unable to load carriers.");
        const enabled = (carrierResult.carriers ?? []).filter((item:{is_active:boolean}) => item.is_active);
        setCarriers(enabled); setCarrierId(enabled[0]?.id ?? "");
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load shipment details."); }
    finally { setProcessingLoading(false); }
  }
  function serialLineOptions(line: ProcessLine) {
    const locationIds = new Set((line.order_item_allocations ?? []).map((allocation) => allocation.inventory_balances?.location_id).filter(Boolean));
    return serialOptions.filter((serial) => serial.product_id === line.product_id && locationIds.has(serial.location_id));
  }
  function addShipmentSerials(line: ProcessLine, values: string[]) {
    if (!processDetails || !values.length) return;
    const current = serialState.current[line.id] ?? [];
    const allElsewhere = new Set(Object.entries(serialState.current).filter(([id]) => id !== line.id).flatMap(([, serials]) => serials));
    const next = [...current]; const required = line.quantity_reserved ?? line.quantity_requested;
    for (const serial of values) {
      if (allElsewhere.has(serial) || next.includes(serial)) { setMessage(`Serial ${serial} was already selected for this shipment.`); continue; }
      if (next.length >= required) { setMessage(`This line requires exactly ${required} serial numbers.`); break; }
      next.push(serial);
    }
    serialState.current = { ...serialState.current, [line.id]: next };
    setShipmentSerials(serialState.current);
  }
  async function verifyAndAddShipmentSerials(line: ProcessLine, values: string[], barcode = false) {
    if (!processing || !values.length) return;
    const version = processVersion.current;
    const orderId = processing.id;
    pendingScans.current++; setPendingScanCount(pendingScans.current);
    scanQueue.current = scanQueue.current.then(async () => {
      if (version !== processVersion.current) return;
      setVerifyingSerials((state) => ({ ...state, [line.id]: true }));
      try {
        if (!barcode) appendSerials(serialState.current[line.id] ?? [], values, line.quantity_reserved ?? line.quantity_requested);
        const response = await fetch("/api/orders/serial-options", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, orderId, orderItemId: line.id, ...(barcode ? { barcode: values[0] } : { serialNumbers: values }) }) });
        const payload = await response.json();
        if (version !== processVersion.current) return;
        if (!response.ok) throw new Error(payload.error ?? "Unable to verify scan.");
        if (barcode) setBarcodeChecks((state) => ({ ...state, [line.id]: true }));
        else addShipmentSerials(line, payload.accepted ?? []);
      } catch (error) {
        if (version !== processVersion.current) return;
        setScanBlocked(true); setMessage(error instanceof Error ? error.message : "Scan blocked.");
      } finally {
        if (version === processVersion.current) { setVerifyingSerials((state) => ({ ...state, [line.id]: false })); scanInputs.current[line.id]?.focus(); }
      }
    }).finally(() => { pendingScans.current--; setPendingScanCount(pendingScans.current); });
    await scanQueue.current;
  }
  function handleShipmentScan(line: ProcessLine, value: string) { if (/[\n,;\t]/.test(value)) { void verifyAndAddShipmentSerials(line, splitSerialInput(value)); setScanValues((state) => ({ ...state, [line.id]: "" })); } else setScanValues((state) => ({ ...state, [line.id]: value })); }
  function commitShipmentScan(line: ProcessLine) { void verifyAndAddShipmentSerials(line, splitSerialInput(scanValues[line.id] ?? "")); setScanValues((state) => ({ ...state, [line.id]: "" })); }
  function removeShipmentSerial(lineId: string, serial: string) { setShipmentSerials((state) => ({ ...state, [lineId]: (state[lineId] ?? []).filter((value) => value !== serial) })); }
  function shipmentReady() {
    if (!processDetails || scanBlocked || pendingScanCount > 0 || pendingScans.current > 0 || !carrierId || !Number.isFinite(Number(weight)) || Number(weight) <= 0) return false;
    const items = processDetails.order_items ?? [];
    return items.length > 0 && items.every((line) => (line.quantity_reserved ?? 0) > 0 && (line.order_item_allocations ?? []).some((allocation) => allocation.quantity_reserved > (allocation.quantity_fulfilled ?? 0)) && (line.products?.is_serialized ? (shipmentSerials[line.id] ?? []).length === line.quantity_reserved : barcodeChecks[line.id]));
  }
  async function reserveFromDrawer() { if (!processing) return; setProcessingBusy(true); try { const changed = await apiTransition(processing, "ALLOCATED", [], pickingLocationId); await openProcessing(changed); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to reserve stock."); } finally { setProcessingBusy(false); } }
  async function shipFromDrawer() {
    if (!processing || !shipmentReady() || shipmentLock.current) return;
    shipmentLock.current = true;
    setProcessingBusy(true);
    try {
      const serials = Object.entries(shipmentSerials).flatMap(([orderItemId, values]) => values.map((serialNumber) => ({ orderItemId, serialNumber })));
      const response = await fetch(`/api/orders/${encodeURIComponent(processing.id)}/shipment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, carrierId: carrierId, weightKg: Number(weight), serials }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to generate AWB and ship this order.");
      const changed = { ...processing, status: "SHIPPED", tracking_number: result.awb, carrier_status: result.carrierStatus ?? "SHIPPED" };
      setOrders((current) => current.map((item) => item.id === processing.id ? changed : item));
      window.open(result.labelUrl, "_blank", "noopener,noreferrer");
      setMessage(`Shipped with AWB ${result.awb}. The printable PDF label has opened in a new tab.`);
      setProcessing(null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to ship this order."); }
    finally { shipmentLock.current = false; setProcessingBusy(false); }
  }

  const headerFields = <><label className="block text-sm">Customer name<input required value={header.customerName} onChange={(event) => updateHeader("customerName", event.target.value)} className="input-field mt-1" /></label><label className="block text-sm">Shipping address<textarea value={header.shippingAddress} onChange={(event) => updateHeader("shippingAddress", event.target.value)} className="input-field mt-1 min-h-20" /></label><div className="grid grid-cols-2 gap-3"><label className="block text-sm">City<input value={header.shippingCity} onChange={(event) => updateHeader("shippingCity", event.target.value)} className="input-field mt-1" /></label><label className="block text-sm">Postcode<input value={header.shippingPostcode} onChange={(event) => updateHeader("shippingPostcode", event.target.value)} className="input-field mt-1" /></label></div><label className="block text-sm">Carrier / channel<input value={header.platform} onChange={(event) => updateHeader("platform", event.target.value)} className="input-field mt-1" /></label></>;
  const lineEditor = <section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order line items</p><div className="mt-3 space-y-3">{lines.map((line, index) => <div key={index} className="grid grid-cols-[1fr_100px_36px] gap-2"><select value={line.productId} onChange={(event) => updateLine(index, { productId: event.target.value })} className="input-field"><option value="">Select SKU…</option>{products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}{product.is_serialized ? " · Serialized" : ""}</option>)}</select><input type="number" min="1" value={line.quantity} onChange={(event) => updateLine(index, { quantity: Number(event.target.value) })} className="input-field" /><button type="button" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((_, i) => i !== index))} className="rounded border border-line text-alert hover:bg-alert/5 disabled:opacity-40" aria-label="Remove line"><Trash2 size={16} className="mx-auto" /></button></div>)}</div><button type="button" onClick={() => setLines((current) => [...current, { productId: "", quantity: 1 }])} className="btn-secondary mt-3">Add line item</button></section>;

  return <div className="space-y-4"><div className="flex items-center justify-between"><p className="text-sm text-graphite">{total} orders · <span className="font-medium text-ink">{orgName}</span></p>{canManage && <button onClick={openCreate} className="btn-primary"><Plus size={16} />Create order</button>}</div><WorkflowNotice notice={message ? { kind: message.startsWith("Shipped with AWB") ? "success" : "error", text: message } : null} /><div className="overflow-hidden rounded-lg border border-line bg-panel"><div className="overflow-x-auto"><table className="mobile-cards w-full min-w-[780px] text-sm"><thead className="sticky top-0 z-10 bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-5 py-3">Order ID</th><th className="px-5 py-3">Organization</th><th className="px-5 py-3">Customer</th><th className="px-5 py-3">Carrier</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Created</th><th className="px-5 py-3" /></tr></thead><tbody>{orders.map((order) => <tr key={order.id} className="border-t border-line transition hover:bg-paper/70"><td data-label="Order" className="px-5 py-3"><button onClick={() => openView(order)} className="code-label font-medium text-rack hover:underline">{order.order_number}</button></td><td data-label="Organization" className="px-5 py-3"><span className="rounded-full bg-rack/10 px-2.5 py-1 text-xs font-medium text-rack">{orgName}</span></td><td data-label="Customer" className="px-5 py-3">{order.customer_name ?? "—"}</td><td data-label="Carrier" className="px-5 py-3 text-graphite">{order.platform}</td><td data-label="Status" className="px-5 py-3"><StatusBadge status={order.status} /></td><td data-label="Created" className="px-5 py-3 text-graphite">{new Date(order.created_at).toLocaleDateString()}</td><td data-label="Actions" className="px-5 py-3"><RowActions onView={() => openView(order)} onEdit={canManage && ["NEW", "DRAFT"].includes(order.status) ? () => openEdit(order) : undefined} onDelete={canManage && ["NEW", "DRAFT"].includes(order.status) ? () => remove(order.id) : undefined} extraActions={[...(order.tracking_number ? [{ label: reprintingOrderId === order.id ? "Preparing AWB…" : "Reprint AWB", onClick: () => void reprintAwb(order) }] : []), ...(canManage ? [...(["NEW", "ALLOCATED"].includes(order.status) ? [{ label: order.status === "NEW" ? "Process / reserve" : "Process shipment", onClick: () => void openProcessing(order) }] : []), ...(["ALLOCATED", "SHIPPED"].includes(order.status) ? [{ label: "Rollback transaction", onClick: () => rollback(order), destructive: true }] : [])] : [])]} /></td></tr>)}</tbody></table></div><PageNavigation page={page} pageSize={50} total={total} /></div>

    <Drawer open={drawer !== null} onClose={() => setDrawer(null)} title={drawer === "create" ? "Create sales order" : drawer === "edit" ? "Edit sales order" : "Order details"} description={drawer === "create" ? `Step ${step} of 2 · ${orgName}` : selected?.order_number}>
      {drawer === "view" && selected ? <div className="space-y-6">
        <section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order header</p><p className="mt-2 text-lg font-medium">{selected.customer_name ?? "Customer not set"}</p><p className="text-sm text-graphite">{[selected.shipping_address, selected.shipping_city, selected.shipping_postcode].filter(Boolean).join(", ") || "Shipping details not recorded"}</p><div className="mt-3 flex flex-wrap items-center gap-2"><StatusBadge status={selected.status} />{selected.tracking_number && <span className="rounded-full bg-rack/10 px-2.5 py-1 text-xs font-semibold text-rack">AWB {selected.tracking_number}</span>}</div><div className="mt-4 flex flex-wrap gap-2">{selected.tracking_number && <button type="button" disabled={reprintingOrderId === selected.id} onClick={() => void reprintAwb(selected)} className="btn-secondary"><Printer size={16} />{reprintingOrderId === selected.id ? "Preparing AWB…" : "Reprint AWB"}</button>}{canManage && editable && <button onClick={() => openEdit(selected)} className="btn-secondary">Edit order</button>}</div></section>
        <section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Line items / pick list</p><div className="mt-2 overflow-hidden rounded-md border border-line"><table className="w-full text-sm"><thead className="bg-paper text-left text-xs text-graphite"><tr><th className="px-4 py-3">SKU</th><th className="px-4 py-3">Product</th><th className="px-4 py-3 text-right">Requested</th><th className="px-4 py-3 text-right">Picked</th></tr></thead><tbody>{(selected.order_items ?? []).map((line) => <tr key={line.id} className="border-t border-line"><td className="px-4 py-3 code-label">{productFor(line.product_id)?.sku ?? "—"}</td><td className="px-4 py-3">{productFor(line.product_id)?.name ?? "Product unavailable"}{productFor(line.product_id)?.is_serialized && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Serialized</span>}</td><td className="px-4 py-3 text-right">{line.quantity_requested}</td><td className="px-4 py-3 text-right">{line.quantity_picked}</td></tr>)}</tbody></table></div></section>
        <section className="rounded-lg border border-violet-200 bg-violet-50/40 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-violet-700">Packing slip / warranty serial record</p><p className="mt-1 text-sm text-graphite">Exact serial numbers dispatched with this sales order.</p></div><span className="rounded-full bg-panel px-2 py-1 text-xs font-semibold text-violet-700">{dispatchedSerials.length} shipped</span></div><div className="mt-3">{dispatchedSerialsLoading ? <p className="text-sm text-graphite">Loading dispatched serial numbers…</p> : dispatchedSerials.length ? <div className="space-y-2">{dispatchedSerials.map((serial) => <div key={serial.id} className="flex flex-wrap items-center justify-between gap-2 rounded bg-panel px-3 py-2 text-sm"><span><span className="code-label font-medium">{serial.serial_number}</span><span className="ml-2 text-graphite">{serial.products?.sku ?? "SKU"} · {serial.products?.name ?? "Product"}</span></span><span className="text-xs text-graphite">{serial.locations?.display_code ?? serial.locations?.location_code ?? "Bin"} · {serial.shipped_at ? new Date(serial.shipped_at).toLocaleString() : "Shipped"}</span></div>)}</div> : <p className="text-sm text-graphite">No dispatched serial numbers are recorded for this sales order.</p>}</div></section>
      </div> : <form onSubmit={drawer === "edit" ? saveOrder : createOrder} className="space-y-6">{drawer === "edit" ? <>{headerFields}{lineEditor}</> : step === 1 ? <section className="space-y-4"><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order header</p>{headerFields}</section> : lineEditor}<WorkflowNotice notice={message ? { kind: message.startsWith("Shipped with AWB") ? "success" : "error", text: message } : null} /><div className="flex justify-between border-t border-line pt-5"><button type="button" onClick={() => drawer === "edit" ? setDrawer("view") : step === 1 ? setDrawer(null) : setStep(1)} className="btn-secondary">{drawer === "edit" ? "Cancel" : step === 1 ? "Cancel" : "Back"}</button>{drawer === "edit" ? <button className="btn-primary">Save order</button> : step === 1 ? <button type="button" onClick={() => { if (!header.customerName.trim()) setMessage("Enter a customer name before continuing."); else { setMessage(""); setStep(2); } }} className="btn-primary">Continue to items</button> : <button className="btn-primary">Create order</button>}</div></form>}
    </Drawer>

    <Drawer open={processing !== null} onClose={() => !processingBusy && setProcessing(null)} title={processing?.status === "NEW" ? "Process sales order" : "Process shipment"} description={processing?.order_number}>{processing && <div className="space-y-5">{processingLoading ? <p className="text-sm text-graphite">Loading allocation and serial details…</p> : processDetails ? <><section className="rounded-md border border-line bg-paper p-4 text-sm"><p className="font-medium">{processDetails.customer_name ?? "Customer"}</p><p className="mt-1 text-graphite">{[processDetails.shipping_address, processDetails.shipping_city, processDetails.shipping_postcode].filter(Boolean).join(", ") || "Shipping details not recorded"}</p><div className="mt-3"><StatusBadge status={processDetails.status} /></div></section>{processDetails.status === "NEW" && <section className="rounded-lg border border-rack/20 bg-rack/5 p-4"><label className="block text-sm font-medium">Picking staging bin<select value={pickingLocationId} onChange={(event) => setPickingLocationId(event.target.value)} className="input-field mt-2"><option value="">No staging bin · reservation remains at source</option>{pickingLocations.map((location) => <option key={location.id} value={location.id}>{location.code}</option>)}</select></label><p className="mt-2 text-xs text-graphite">This is the staging destination for picked goods. Allocation selects an eligible source bin for each SKU automatically. Leave blank to keep reservations at the source.</p></section>}<section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Order lines and allocated bins</p><div className="mt-2 space-y-3">{(processDetails.order_items ?? []).map((line) => { const serialized = Boolean(line.products?.is_serialized); const required = line.quantity_reserved ?? line.quantity_requested; const selectedSerials = shipmentSerials[line.id] ?? []; const options = serialLineOptions(line); return <div key={line.id} className={`rounded-lg border p-4 ${serialized ? "border-violet-200 bg-violet-50/40" : "border-line"}`}><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="font-medium"><span className="code-label">{line.products?.sku ?? productFor(line.product_id)?.sku ?? "SKU"}</span><span className="ml-2">{line.products?.name ?? productFor(line.product_id)?.name ?? "Product unavailable"}</span>{serialized && <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700">Serialized</span>}</p><p className="mt-1 text-xs text-graphite">Requested {line.quantity_requested} · Reserved {required}</p></div>{serialized && <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${selectedSerials.length === required ? "bg-emerald-100 text-go" : "bg-amber/20 text-amber-dark"}`}>{selectedSerials.length} / {required} serials</span>}</div><div className="mt-3 rounded border border-line bg-panel px-3 py-2 text-xs text-graphite">Pick from: {(line.order_item_allocations ?? []).map((allocation) => `${binLabel(allocation.inventory_balances?.locations)} (${allocation.quantity_reserved})${allocation.picking_location ? ` → Stage: ${binLabel(allocation.picking_location)}` : ""}`).join(" · ") || "Reserve inventory first"}</div>{!serialized && processDetails.status === "ALLOCATED" && <label className="mt-3 block text-sm font-medium">Scan product barcode / SKU {barcodeChecks[line.id] ? "✓ Verified" : ""}<input ref={(node) => { scanInputs.current[line.id] = node; }} autoComplete="off" spellCheck={false} placeholder="Scan product, then Enter" className="input-field mt-1" onKeyDown={(event) => { if (event.key === "Enter" || (event.key === "Tab" && event.currentTarget.value.trim())) { event.preventDefault(); const value = event.currentTarget.value.trim(); event.currentTarget.value = ""; void verifyAndAddShipmentSerials(line, [value], true); } }} /></label>}{serialized && processDetails.status === "ALLOCATED" && <><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px_auto]"><div className="relative"><ScanLine size={16} className="absolute left-3 top-3 text-graphite" /><input ref={(node) => { scanInputs.current[line.id] = node; }} autoComplete="off" spellCheck={false} value={scanValues[line.id] ?? ""} onChange={(event) => handleShipmentScan(line, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || (event.key === "Tab" && (scanValues[line.id] ?? "").trim())) { event.preventDefault(); commitShipmentScan(line); } }} placeholder="Scan serial, then press Enter" className="input-field pl-9" /></div><select defaultValue="" onChange={(event) => { if (event.target.value) { void verifyAndAddShipmentSerials(line, [event.target.value]); event.currentTarget.value = ""; } }} className="input-field"><option value="">Select available serial…</option>{options.map((serial) => <option key={serial.serial_number} value={serial.serial_number}>{serial.serial_number}</option>)}</select><button type="button" onClick={() => commitShipmentScan(line)} className="btn-secondary">Add</button></div>{serialsTruncated && <p className="mt-2 text-xs text-graphite">The selection list is capped at 100 serials; scanning remains available for every valid serial.</p>}{selectedSerials.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{selectedSerials.map((serial) => <span key={serial} className="inline-flex items-center gap-1 rounded bg-panel px-2 py-1 text-xs code-label"><span>{serial}</span><button type="button" onClick={() => removeShipmentSerial(line.id, serial)} className="text-alert" aria-label={`Remove ${serial}`}><Trash2 size={13} /></button></span>)}</div>}</>}</div>; })}</div></section><WorkflowNotice notice={message ? { kind: message.startsWith("Shipped with AWB") ? "success" : "error", text: message } : null} />{scanBlocked && <div className="rounded-lg border-2 border-alert p-4"><p className="font-semibold text-alert">Picking stopped — check the product and bin.</p><button type="button" onClick={() => { setScanBlocked(false); setMessage(""); }} className="btn-secondary mt-3">I checked the issue — resume scanning</button></div>}{processDetails.status === "ALLOCATED" && <section className="space-y-3 rounded-lg border border-line p-4"><label className="block text-sm font-medium">Carrier<select value={carrierId} onChange={(event) => setCarrierId(event.target.value)} className="input-field mt-1"><option value="">Select enabled carrier…</option>{carriers.map((carrier) => <option key={carrier.id} value={carrier.id}>{carrier.display_name}</option>)}</select></label>{!carriers.length && <WorkflowNotice notice={{kind:"error",text:"No enabled carrier is available. Configure one in Manage Carriers before shipping."}} />}<label className="block text-sm font-medium">Measured parcel weight (kg)<input type="number" required min="0.001" max="10000" step="0.001" value={weight} onChange={(event) => setWeight(event.target.value)} className="input-field mt-1" /></label><p className="text-xs text-graphite">Verify every product barcode or serial, select a carrier, and enter the measured weight to enable shipment.</p></section>}<div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" disabled={processingBusy} onClick={() => setProcessing(null)} className="btn-secondary">Close</button>{processDetails.status === "NEW" && <button type="button" disabled={processingBusy} onClick={() => void reserveFromDrawer()} className="btn-primary">{processingBusy ? "Reserving…" : "Reserve inventory"}</button>}{processDetails.status === "ALLOCATED" && <button type="button" disabled={!shipmentReady() || processingBusy} onClick={() => void shipFromDrawer()} className="btn-primary"><Truck size={16} />{processingBusy ? "Shipping…" : "Ship / fulfill"}</button>}</div></> : <p role="alert" className="text-sm text-alert">{message || "Shipment details are unavailable."}</p>}</div>}</Drawer>
  </div>;
}
