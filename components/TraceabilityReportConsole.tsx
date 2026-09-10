"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Location = { id: string; zone_id: string; location_code: string; display_code?: string | null };
type Zone = { id: string; warehouse_id: string; zone_code: string };
type Warehouse = { id: string; code: string; name: string };
type TraceRow = {
  event_id: string; event_type: string; occurred_at: string; status: string; quantity_delta: number; item_condition: string; reason: string;
  sku: string; product_name: string; purchase_order_number?: string | null; sales_order_number?: string | null; rma_number?: string | null; rtv_number?: string | null;
  supplier_name?: string | null; customer_name?: string | null; warehouse_id?: string | null; zone_id?: string | null; location_id?: string | null; bin_path: string;
};

function dateWindow(preset: string, customFrom: string, customTo: string) {
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "TODAY") return { from: today.toISOString(), to: new Date(today.getTime() + 86_400_000).toISOString() };
  if (preset === "LAST_7_DAYS") return { from: new Date(today.getTime() - 6 * 86_400_000).toISOString(), to: new Date(today.getTime() + 86_400_000).toISOString() };
  if (preset === "THIS_MONTH") return { from: new Date(now.getFullYear(), now.getMonth(), 1).toISOString(), to: new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString() };
  return { from: customFrom ? new Date(`${customFrom}T00:00:00`).toISOString() : "", to: customTo ? new Date(new Date(`${customTo}T00:00:00`).getTime() + 86_400_000).toISOString() : "" };
}

export function TraceabilityReportConsole({ orgId, orgName, warehouses, zones, locations, serialEvents }: { orgId: string; orgName: string; warehouses: Warehouse[]; zones: Zone[]; locations: Location[]; serialEvents: any[] }) {
  const [preset, setPreset] = useState("LAST_7_DAYS"); const [customFrom, setCustomFrom] = useState(""); const [customTo, setCustomTo] = useState("");
  const [warehouseId, setWarehouseId] = useState(""); const [zoneId, setZoneId] = useState(""); const [locationId, setLocationId] = useState("");
  const [eventType, setEventType] = useState("ALL"); const [query, setQuery] = useState(""); const [rows, setRows] = useState<TraceRow[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  const visibleZones = useMemo(() => zones.filter((zone) => !warehouseId || zone.warehouse_id === warehouseId), [zones, warehouseId]);
  const visibleLocations = useMemo(() => locations.filter((location) => !zoneId || location.zone_id === zoneId), [locations, zoneId]);
  const timeWindow = useMemo(() => dateWindow(preset, customFrom, customTo), [preset, customFrom, customTo]);
  const serialRows = useMemo(() => serialEvents.filter((serial) => !query || `${serial.serialNumber ?? ""} ${serial.products?.sku ?? ""} ${serial.products?.name ?? ""}`.toLowerCase().includes(query.toLowerCase())), [serialEvents, query]);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ orgId, eventType, limit: "100" });
      if (timeWindow.from) params.set("from", timeWindow.from); if (timeWindow.to) params.set("to", timeWindow.to); if (warehouseId) params.set("warehouseId", warehouseId); if (zoneId) params.set("zoneId", zoneId); if (locationId) params.set("locationId", locationId); if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/reports/traceability?${params}`, { signal, cache: "no-store" }); const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load the report."); setRows(result.rows ?? []);
    } catch (cause) { if ((cause as Error).name !== "AbortError") setError(cause instanceof Error ? cause.message : "Unable to load the report."); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [orgId, eventType, timeWindow.from, timeWindow.to, warehouseId, zoneId, locationId, query]);

  useEffect(() => { const controller = new AbortController(); const timer = window.setTimeout(() => void load(controller.signal), query ? 250 : 0); return () => { window.clearTimeout(timer); controller.abort(); }; }, [load, query]);

  return <div className="space-y-6 rounded-lg border border-line bg-panel p-5">
    <div><h2 className="font-semibold">Operational traceability</h2><p className="mt-1 text-sm text-graphite">{orgName} · linked PO, SO, RMA, RTV, dock-rejection and cycle-count events.</p></div>
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      <label className="text-xs text-graphite">Date range<select value={preset} onChange={(event) => setPreset(event.target.value)} className="input-field mt-1"><option value="TODAY">Today</option><option value="LAST_7_DAYS">Last 7 days</option><option value="THIS_MONTH">This month</option><option value="CUSTOM">Custom</option></select></label>
      {preset === "CUSTOM" && <><label className="text-xs text-graphite">From<input type="date" value={customFrom} onChange={(event) => setCustomFrom(event.target.value)} className="input-field mt-1" /></label><label className="text-xs text-graphite">To<input type="date" value={customTo} onChange={(event) => setCustomTo(event.target.value)} className="input-field mt-1" /></label></>}
      <label className="text-xs text-graphite">Warehouse<select value={warehouseId} onChange={(event) => { setWarehouseId(event.target.value); setZoneId(""); setLocationId(""); }} className="input-field mt-1"><option value="">All warehouses</option>{warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
      <label className="text-xs text-graphite">Zone<select value={zoneId} onChange={(event) => { setZoneId(event.target.value); setLocationId(""); }} disabled={!warehouseId} className="input-field mt-1"><option value="">{warehouseId ? "All zones" : "Choose warehouse first"}</option>{visibleZones.map((zone) => <option key={zone.id} value={zone.id}>{zone.zone_code}</option>)}</select></label>
      <label className="text-xs text-graphite">Bin<select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={!zoneId} className="input-field mt-1"><option value="">{zoneId ? "All bins" : "Choose zone first"}</option>{visibleLocations.map((location) => <option key={location.id} value={location.id}>{location.display_code ?? location.location_code} · {location.location_code}</option>)}</select></label>
      <label className="text-xs text-graphite">Event<select value={eventType} onChange={(event) => setEventType(event.target.value)} className="input-field mt-1"><option value="ALL">All events</option><option value="INVENTORY">Inventory ledger</option><option value="PO_REJECTED">PO dock rejections</option><option value="RMA">Customer returns</option><option value="RTV">Vendor returns</option><option value="CYCLE_COUNT">Cycle counts</option></select></label>
    </div>
    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU, PO, SO, RMA, RTV, supplier, customer, or bin" className="input-field" />
    {error && <p role="alert" className="rounded-md bg-alert/10 px-3 py-2 text-sm text-alert">{error}</p>}
    <div className="overflow-x-auto"><table className="w-full min-w-[1320px] text-sm"><thead className="bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Event / status</th><th className="px-3 py-3">SKU</th><th className="px-3 py-3 text-right">Qty</th><th className="px-3 py-3">Condition</th><th className="px-3 py-3">PO / SO / return</th><th className="px-3 py-3">Supplier / customer</th><th className="px-3 py-3">Exact location</th><th className="px-3 py-3">Reason</th></tr></thead><tbody>{loading ? <tr><td colSpan={9} className="px-3 py-8 text-center text-graphite">Loading traceability events…</td></tr> : rows.length ? rows.map((row) => <tr key={`${row.event_type}-${row.event_id}`} className="border-t border-line hover:bg-paper/60"><td className="px-3 py-3 text-graphite">{new Date(row.occurred_at).toLocaleString()}</td><td className="px-3 py-3"><StatusBadge status={row.event_type === "INVENTORY" ? row.status : row.event_type} /><span className="ml-2 text-xs text-graphite">{row.status}</span></td><td className="px-3 py-3"><span className="code-label">{row.sku}</span><span className="ml-2">{row.product_name}</span></td><td className={`px-3 py-3 text-right font-medium ${row.quantity_delta > 0 ? "text-go" : row.quantity_delta < 0 ? "text-alert" : ""}`}>{row.quantity_delta > 0 ? "+" : ""}{row.quantity_delta || "—"}</td><td className="px-3 py-3">{row.item_condition || "—"}</td><td className="px-3 py-3 code-label">{[row.purchase_order_number, row.sales_order_number, row.rma_number, row.rtv_number].filter(Boolean).join(" · ") || "—"}</td><td className="px-3 py-3">{[row.supplier_name, row.customer_name].filter(Boolean).join(" · ") || "—"}</td><td className="px-3 py-3">{row.bin_path || "—"}</td><td className="px-3 py-3 text-graphite">{row.reason || "—"}</td></tr>) : <tr><td colSpan={9} className="px-3 py-8 text-center text-graphite">No traceability events match the active filters.</td></tr>}</tbody></table></div>
    <section><div className="flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Serial in / serial out</p><span className="text-xs text-graphite">Latest serial events</span></div><div className="mt-3 overflow-x-auto rounded border border-line"><table className="w-full min-w-[760px] text-sm"><thead className="bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Direction</th><th className="px-3 py-3">Serial</th><th className="px-3 py-3">SKU</th><th className="px-3 py-3">Bin</th><th className="px-3 py-3">Reference</th></tr></thead><tbody>{serialRows.map((serial) => <tr key={serial.id} className="border-t border-line"><td className="px-3 py-3">{new Date(serial.occurredAt).toLocaleString()}</td><td className="px-3 py-3">{serial.direction}</td><td className="px-3 py-3 code-label">{serial.serialNumber}</td><td className="px-3 py-3">{serial.products?.sku} · {serial.products?.name}</td><td className="px-3 py-3">{serial.locations?.display_code ?? serial.locations?.location_code ?? "—"}</td><td className="px-3 py-3 code-label">{serial.purchase_orders?.po_number ?? serial.sales_orders?.order_number ?? "—"}</td></tr>)}</tbody></table></div></section>
  </div>;
}
