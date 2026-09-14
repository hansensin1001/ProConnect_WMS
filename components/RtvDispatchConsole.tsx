"use client";

import { useEffect, useRef, useState } from "react";
import { Eye, Send } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { WorkflowNotice, type Notice } from "@/components/ui/WorkflowNotice";
import { warehouseError } from "@/lib/warehouse-ui";

type RtvItem = {
  id: string; quantity: number; reason: string;
  products?: { sku?: string; name?: string; is_serialized?: boolean } | null;
  locations?: { display_code?: string | null; location_code?: string | null; warehouse_zones?: { zone_code?: string | null; warehouses?: { name?: string | null } | null } | null } | null;
  rtv_serial_numbers?: { serial_number: string }[] | null;
};
type Rtv = { id: string; rtv_number: string; supplier_name: string; status: string; created_at: string; return_to_vendor_items?: RtvItem[] | null };

function binPath(item: RtvItem) {
  const location = item.locations;
  const zone = location?.warehouse_zones;
  return [zone?.warehouses?.name, zone?.zone_code, location?.display_code ?? location?.location_code].filter(Boolean).join(" / ") || "[Original bin unavailable]";
}

export function RtvDispatchConsole({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Rtv[]>([]);
  const [selected, setSelected] = useState<Rtv | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const requestLock = useRef(false);
  async function load() {
    setLoading(true);
    try {
      const response = await fetch(`/api/exceptions?orgId=${encodeURIComponent(orgId)}&view=rtvs`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load vendor returns.");
      setRows(payload.rtvs ?? []);
    } catch (error) { setNotice({ kind: "error", text: warehouseError(error, "Unable to load vendor returns.") }); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [orgId]);
  function view(row: Rtv) { setSelected(row); setConfirmed(false); setNotice(null); }
  async function dispatch() {
    if (!selected || selected.status !== "PENDING" || !confirmed || requestLock.current) return;
    requestLock.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, action: "dispatchRtv", rtvId: selected.id }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to dispatch this RTV.");
      setRows((current) => current.map((row) => row.id === selected.id ? { ...row, status: "SHIPPED" } : row));
      setSelected((current) => current ? { ...current, status: "SHIPPED" } : current);
      setNotice({ kind: "success", text: `${selected.rtv_number} is dispatched. The listed stock has been deducted and the dispatch is recorded in inventory traceability.` });
    } catch (error) { setNotice({ kind: "error", text: warehouseError(error, "RTV dispatch failed. Nothing was dispatched; refresh and verify the source stock.") }); }
    finally { requestLock.current = false; setBusy(false); }
  }
  return <section className="mt-8 border-t border-line pt-8">
    <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-lg font-semibold">Vendor return review & dispatch</h2><p className="mt-1 text-sm text-graphite">Dispatch only after the goods have been checked, packed, and handed to the vendor or carrier.</p></div><button type="button" onClick={() => void load()} disabled={loading} className="btn-secondary">{loading ? "Refreshing…" : "Refresh"}</button></div>
    <WorkflowNotice notice={notice} />
    <div className="mt-4 overflow-x-auto rounded-xl border border-line bg-panel"><table className="mobile-cards w-full min-w-[680px] text-sm"><thead className="bg-paper text-left text-xs uppercase tracking-wide text-graphite"><tr><th className="px-4 py-3">RTV</th><th className="px-4 py-3">Supplier</th><th className="px-4 py-3">Created</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Action</th></tr></thead><tbody>{loading ? <tr><td colSpan={5} className="px-4 py-8 text-center text-graphite">Loading vendor returns…</td></tr> : rows.length ? rows.map((row) => <tr key={row.id} className="border-t border-line hover:bg-paper/60"><td data-label="RTV" className="px-4 py-3 code-label">{row.rtv_number}</td><td data-label="Supplier" className="px-4 py-3">{row.supplier_name}</td><td data-label="Created" className="px-4 py-3 text-graphite">{new Date(row.created_at).toLocaleString()}</td><td data-label="Status" className="px-4 py-3"><StatusBadge status={row.status} /></td><td data-label="Action" className="px-4 py-3 text-right"><button type="button" onClick={() => view(row)} className="btn-secondary"><Eye size={16} />View {row.status === "PENDING" ? "& dispatch" : "record"}</button></td></tr>) : <tr><td colSpan={5} className="px-4 py-8 text-center text-graphite">No RTV records yet.</td></tr>}</tbody></table></div>
    <Drawer open={selected !== null} onClose={() => !busy && setSelected(null)} title={selected?.rtv_number ?? "RTV"} description={selected ? `Vendor: ${selected.supplier_name}` : undefined}>{selected && <div className="space-y-5"><WorkflowNotice notice={notice} /><section className="rounded-lg border border-line bg-paper p-4"><div className="flex items-center justify-between gap-3"><span className="text-sm font-medium">Dispatch status</span><StatusBadge status={selected.status} /></div><p className="mt-2 text-sm text-graphite">Created {new Date(selected.created_at).toLocaleString()}</p></section><section><h3 className="text-sm font-semibold uppercase tracking-wide text-graphite">Goods leaving the warehouse</h3><div className="mt-2 space-y-3">{(selected.return_to_vendor_items ?? []).map((item) => <article key={item.id} className="rounded-lg border border-line p-4"><div className="flex flex-wrap justify-between gap-2"><p className="font-medium"><span className="code-label">{item.products?.sku ?? "SKU"}</span><span className="ml-2">{item.products?.name ?? "Product"}</span></p><strong>{item.quantity} unit{item.quantity === 1 ? "" : "s"}</strong></div><p className="mt-2 text-sm text-graphite">Take from: {binPath(item)}</p><p className="mt-1 text-sm text-graphite">Reason: {item.reason}</p>{item.rtv_serial_numbers?.length ? <p className="mt-2 break-all text-xs text-graphite">Serials: {item.rtv_serial_numbers.map((serial) => serial.serial_number).join(", ")}</p> : null}</article>)}</div></section>{selected.status === "PENDING" ? <section className="rounded-lg border-2 border-amber/40 bg-amber/10 p-4"><h3 className="font-semibold">Final dispatch confirmation</h3><p className="mt-1 text-sm text-graphite">This permanently deducts the exact listed stock from the original bins, changes the RTV to Shipped, and writes an outbound audit entry. It cannot be undone from this screen.</p><label className="mt-4 flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />I verified the SKU, quantity, serials and physical handover.</label><button type="button" disabled={!confirmed || busy} onClick={() => void dispatch()} className="btn-danger mt-4"><Send size={16} />{busy ? "Dispatching…" : "Confirm dispatch to vendor"}</button></section> : <WorkflowNotice notice={{ kind: "success", text: "This RTV has already been dispatched. Its outbound transaction remains available in Reports." }} />}</div>}</Drawer>
  </section>;
}
