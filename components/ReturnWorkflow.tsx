"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SerialScanner } from "@/components/ui/SerialScanner";
import { WorkflowNotice, type Notice } from "@/components/ui/WorkflowNotice";
import { binLabel, warehouseError } from "@/lib/warehouse-ui";

type Zone = { zone_type?: string | null; zone_code?: string | null; warehouses?: { name?: string } | null };
export type ReturnBin = { id: string; location_code?: string; display_code?: string | null; warehouse_zones?: Zone | Zone[] | null };
export type ReturnLine = { product_id: string; location_id?: string; quantity_received?: number; quantity_picked?: number; products?: { sku?: string; name?: string | null; is_serialized?: boolean } | null; locations?: ReturnBin | null };
export type ReturnOrder = { id: string; reference: string; party: string | null; lines: ReturnLine[] };

function zone(bin: ReturnBin) { return Array.isArray(bin.warehouse_zones) ? bin.warehouse_zones[0] : bin.warehouse_zones; }
function pathLabel(bin: ReturnBin) { return [zone(bin)?.warehouses?.name, zone(bin)?.zone_code, binLabel(bin)].filter(Boolean).join(" / "); }

export function ReturnWorkflow({ kind, orgId, orders, bins = [] }: { kind: "RMA" | "RTV"; orgId: string; orders: ReturnOrder[]; bins?: ReturnBin[] }) {
  const router = useRouter();
  const [orderId, setOrderId] = useState(orders.length === 1 ? orders[0].id : "");
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [disposition, setDisposition] = useState("QUARANTINE");
  const [reason, setReason] = useState("");
  const [serials, setSerials] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const requestLock = useRef(false);
  const order = orders.find((item) => item.id === orderId);
  const products = useMemo(() => [...new Map((order?.lines ?? []).filter((line) => kind === "RMA" || (line.quantity_received ?? 0) > 0).map((line) => [line.product_id, line])).values()], [order, kind]);
  const product = products.find((line) => line.product_id === productId);
  const eligibleBins = useMemo(() => {
    const list = kind === "RMA" ? bins.filter((bin) => zone(bin)?.zone_type === (disposition === "PUTAWAY" ? "STORAGE" : "QUARANTINE"))
      : (order?.lines ?? []).filter((line) => line.product_id === productId && (line.quantity_received ?? 0) > 0 && line.location_id && line.locations && zone(line.locations)?.zone_type === "STORAGE")
        .map((line) => ({ ...line.locations!, id: line.location_id! }));
    return [...new Map(list.map((bin) => [bin.id, bin])).values()].sort((a, b) => binLabel(a).localeCompare(binLabel(b), undefined, { numeric: true }));
  }, [kind, bins, disposition, order, productId]);
  useEffect(() => { setProductId((current) => products.some((line) => line.product_id === current) ? current : products[0]?.product_id ?? ""); }, [products]);
  useEffect(() => { setLocationId((current) => eligibleBins.some((bin) => bin.id === current) ? current : eligibleBins[0]?.id ?? ""); }, [eligibleBins]);
  useEffect(() => { setSerials([]); setQuantity("1"); }, [orderId, productId, locationId]);
  const serialized = Boolean(product?.products?.is_serialized);
  const parsed = Number(quantity);
  const upperBound = (order?.lines ?? []).filter((line) => line.product_id === productId && (kind === "RMA" || line.location_id === locationId))
    .reduce((sum, line) => sum + (kind === "RMA" ? line.quantity_picked ?? 0 : line.quantity_received ?? 0), 0);
  const destination = eligibleBins.find((bin) => bin.id === locationId);
  const ready = Boolean(order && product && destination && reason.trim() && Number.isSafeInteger(parsed) && parsed > 0 && parsed <= upperBound && (!serialized || serials.length === parsed));
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (requestLock.current || completed) return;
    if (!ready) { setNotice({ kind: "error", text: "Select the original document, SKU, eligible bin, quantity and reason. Serialized items need one unique serial per unit." }); return; }
    requestLock.current = true; setBusy(true); setNotice(null);
    try {
      const line = { productId, locationId, quantity: parsed, reason: reason.trim(), serialNumbers: serialized ? serials : [] };
      const body = kind === "RMA" ? { action: "createRma", salesOrderId: order!.id, customerName: order!.party ?? "", lines: [{ ...line, disposition }] }
        : { action: "createRtv", supplierName: order!.party ?? "", lines: [{ ...line, purchaseOrderId: order!.id }] };
      const response = await fetch("/api/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, ...body }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save the return.");
      setCompleted(true);
      setNotice({ kind: "success", text: kind === "RTV" ? "RTV created for review. Stock has not been dispatched. Keep the goods in the source bin until the vendor return is dispatched." : disposition === "QUARANTINE" ? "Return received into the quarantine bin shown below. These units are not available for sales." : "Return received into the storage bin shown below." });
      router.refresh();
    } catch (error) { setNotice({ kind: "error", text: warehouseError(error, "The return could not be confirmed. Check the return records before retrying if the connection was interrupted.") }); }
    finally { requestLock.current = false; setBusy(false); }
  }
  return <form onSubmit={submit} className="max-w-3xl rounded-xl border border-line bg-panel p-4 sm:p-6">
    <h2 className="text-lg font-semibold">{kind === "RMA" ? "Receive customer return" : "Create vendor return"}</h2>
    <p className="mt-1 text-sm text-graphite">{kind === "RMA" ? "Match the return to its shipped sales order. Damaged goods go to quarantine; inspected good stock goes to storage." : "Match accepted stock to its purchase order and original storage bin. Goods refused at the receiving dock are recorded in Partial Receive."}</p>
    <WorkflowNotice notice={notice} />
    {!orders.length && <WorkflowNotice notice={{ kind: "info", text: kind === "RMA" ? "No completed shipped sales orders are available. A customer return must reference a verified shipment." : "No accepted purchase order stock is available for return." }} />}
    <fieldset disabled={busy || completed} className="mt-5 space-y-4">
      <label className="block text-sm font-medium">{kind === "RMA" ? "Shipped sales order" : "Accepted purchase order"}<select required value={orderId} onChange={(event) => { setOrderId(event.target.value); setProductId(""); setSerials([]); setNotice(null); }} className="input-field mt-1"><option value="">Select document…</option>{orders.map((item) => <option key={item.id} value={item.id}>{item.reference} · {item.party || "Name not recorded"}</option>)}</select></label>
      <label className="block text-sm font-medium">Product on this document<select required disabled={!order} value={productId} onChange={(event) => { setProductId(event.target.value); setSerials([]); setNotice(null); }} className="input-field mt-1"><option value="">Select SKU…</option>{products.map((line) => <option key={line.product_id} value={line.product_id}>{line.products?.sku} · {line.products?.name}</option>)}</select></label>
      {kind === "RMA" && <label className="block text-sm font-medium">Inspected condition<select value={disposition} onChange={(event) => { setDisposition(event.target.value); setLocationId(""); }} className="input-field mt-1"><option value="QUARANTINE">Damaged — hold in quarantine</option><option value="PUTAWAY">Good — restock in storage</option></select></label>}
      <label className="block text-sm font-medium">{kind === "RTV" ? "Source storage bin" : "Destination bin"}<select required value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={!eligibleBins.length} className="input-field mt-1"><option value="">Select eligible bin…</option>{eligibleBins.map((bin) => <option key={bin.id} value={bin.id}>{pathLabel(bin)}</option>)}</select></label>
      {order && product && !eligibleBins.length && <WorkflowNotice notice={{ kind: "error", text: kind === "RTV" ? "This PO line has no eligible original storage bin. Review its accepted receipt and location before returning stock." : "No active bin matches this condition. Create a bin in a QUARANTINE or STORAGE zone in Locations, then reload." }} />}
      {destination && <p className="rounded-lg border border-line bg-paper p-3 text-sm"><strong>{kind === "RTV" ? "Take goods from: " : "Place goods in: "}</strong>{pathLabel(destination)}</p>}
      <div className="grid gap-4 sm:grid-cols-2"><label className="block text-sm font-medium">Quantity<input required inputMode="numeric" type="number" step="1" min="1" max={upperBound || 1} value={quantity} onChange={(event) => setQuantity(event.target.value)} className="input-field mt-1" /><span className="mt-1 block text-xs font-normal text-graphite">{upperBound} units {kind === "RMA" ? "shipped" : "accepted"} on this document. Previously returned or unavailable units are checked at confirmation.</span></label><label className="block text-sm font-medium">Reason<input required maxLength={250} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Describe the return reason" className="input-field mt-1" /></label></div>
      {serialized && <SerialScanner key={orderId + productId + locationId} serials={serials} quantity={parsed} onChange={setSerials} disabled={busy || completed} label={kind === "RMA" ? "Scan the serials shipped on this SO" : "Scan in-stock serials received on this PO"} />}
    </fieldset>
    {completed ? <button type="button" onClick={() => { setCompleted(false); setOrderId(""); setProductId(""); setLocationId(""); setSerials([]); setReason(""); setNotice(null); }} className="btn-secondary mt-5">Start another return</button> : <button disabled={busy || !ready} className="btn-primary mt-5 w-full justify-center sm:w-auto">{busy ? "Confirming…" : kind === "RMA" ? "Confirm received return" : "Create RTV for review"}</button>}
    {kind === "RTV" && <Link href="/reports" className="ml-4 inline-flex min-h-11 items-center text-sm font-medium text-rack underline">View return records</Link>}
  </form>;
}
