"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { WorkflowNotice } from "@/components/ui/WorkflowNotice";
import { binLabel, warehouseError } from "@/lib/warehouse-ui";
import { Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageNavigation } from "@/components/ui/PageNavigation";

type StockByLocation = {
  locationId: string;
  warehouseName: string;
  zoneCode: string;
  locationCode: string;
  onHand: number;
  reserved: number;
  available: number;
  inbound: number;
  quarantined: number;
  serialNumbers: string[];
};

type AvailableSerial = { serialNumber: string; locationCode: string };
type Location = { id: string; display_code?: string; location_code: string };
type InventoryRow = {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  description?: string | null;
  price?: number;
  unit_of_measure: string;
  is_serialized: boolean;
  onHand: number;
  reserved: number;
  quarantined: number;
  locations: number;
};
type Mode = "view" | "edit" | "adjust" | null;

export function InventoryTableV2({
  orgId,
  rows,
  canManage,
  page,
  total,
}: {
  orgId: string;
  rows: InventoryRow[];
  canManage: boolean;
  page: number;
  total: number;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState(rows);
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [message, setMessage] = useState("");
  const [stockByLocation, setStockByLocation] = useState<StockByLocation[]>([]);
  const [stockTotal, setStockTotal] = useState(0);
  const [availableSerials, setAvailableSerials] = useState<AvailableSerial[]>([]);
  const [serialTotal, setSerialTotal] = useState(0);
  const [stockLoading, setStockLoading] = useState(false);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationQuery, setLocationQuery] = useState("");
  const [locationsLoading, setLocationsLoading] = useState(false);
  const detailVersion = useRef(0);
  const locationVersion = useRef(0);
  const mutationLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [messageKind, setMessageKind] = useState<"error" | "success">("error");

  useEffect(() => setItems(rows), [rows]);

  async function loadStockDetails(product: InventoryRow) {
    const version = ++detailVersion.current;
    setStockLoading(true);
    try {
      const response = await fetch(
        `/api/inventory-stock?orgId=${encodeURIComponent(orgId)}&productId=${encodeURIComponent(product.id)}`,
      );
      const payload = await response.json();
      if (version !== detailVersion.current) return;
      if (!response.ok) throw new Error(payload.error ?? "Unable to load stock details.");
      setStockByLocation(payload.stock ?? []);
      setStockTotal(payload.total ?? 0);
      setAvailableSerials(payload.serials ?? []);
      setSerialTotal(payload.serialTotal ?? 0);
    } catch (error) {
      if (version === detailVersion.current) { setMessageKind("error"); setMessage(warehouseError(error, "Unable to load stock details.")); }
    } finally {
      if (version === detailVersion.current) setStockLoading(false);
    }
  }

  async function loadLocations(query = "") {
    const version = ++locationVersion.current;
    setLocationsLoading(true);
    try {
      const response = await fetch(
        `/api/location-options?orgId=${encodeURIComponent(orgId)}&q=${encodeURIComponent(query)}`,
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to load bin locations.");
      if (version === locationVersion.current) setLocations(payload.locations ?? []);
    } catch (error) {
      if (version === locationVersion.current) { setMessageKind("error"); setMessage(warehouseError(error, "Unable to load bin locations.")); }
    } finally {
      if (version === locationVersion.current) setLocationsLoading(false);
    }
  }

  function open(next: Exclude<Mode, null>, row: InventoryRow) {
    setSelected(row);
    setMode(next);
    setMessage("");
    setMessageKind("error");
    if (next === "adjust") {
      setLocationQuery("");
      void loadLocations();
      return;
    }
    setStockByLocation([]);
    setStockTotal(0);
    setAvailableSerials([]);
    setSerialTotal(0);
    void loadStockDetails(row);
  }

  function close() {
    if (busy) return;
    detailVersion.current++; locationVersion.current++;
    setMode(null);
    setSelected(null);
  }

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setMessageKind("error");
    try {
      const form = new FormData(event.currentTarget);
      const price = Number(form.get("price") ?? 0);
      if (!Number.isFinite(price) || price < 0) throw new Error("Price must be zero or greater.");
      const patch = {
        barcode: String(form.get("barcode") ?? "").trim(),
        name: String(form.get("name") ?? "").trim(),
        description: String(form.get("description") ?? "").trim() || null,
        price,
        unit_of_measure: String(form.get("uom") ?? "PCS").trim() || "PCS",
        is_serialized: form.get("isSerialized") === "on",
      };
      if (!patch.name || !patch.barcode) throw new Error("Product name and barcode are required.");
      if (patch.is_serialized !== selected.is_serialized && (selected.onHand || selected.reserved || selected.quarantined)) throw new Error("Clear stock and reservations before changing serial tracking. Existing stock cannot be converted by changing a flag.");
      const { error } = await (supabase.from("products") as any)
        .update(patch)
        .eq("id", selected.id)
        .eq("org_id", orgId);
      if (error) throw error;
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
      setSelected((current) => current ? { ...current, ...patch } : current);
      setMessageKind("success"); setMessage("SKU details saved.");
    } catch (error) {
      setMessage(warehouseError(error, "Unable to save the SKU."));
    } finally { mutationLock.current = false; setBusy(false); }
  }

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || mutationLock.current) return;
    mutationLock.current = true; setBusy(true); setMessageKind("error");
    try {
      const form = new FormData(event.currentTarget);
      if (selected.is_serialized) throw new Error("Serialized stock must be received or returned with its serial numbers. Quantity-only adjustments would break serial tracking.");
      if (!locations.some((bin) => bin.id === form.get("locationId"))) throw new Error("Select a valid active storage bin.");
      const quantity = Number(form.get("quantity"));
      if (!Number.isInteger(quantity) || quantity === 0) {
        throw new Error("Enter a whole-number adjustment other than zero.");
      }
      const { error } = await (supabase.rpc as any)("apply_stock_adjustment", {
        p_org_id: orgId,
        p_product_id: selected.id,
        p_location_id: form.get("locationId"),
        p_quantity_delta: quantity,
        p_reason: String(form.get("reason") ?? "").trim() || "Manual stock adjustment",
      });
      if (error) throw error;
      setItems((current) => current.map((item) => (
        item.id === selected.id ? { ...item, onHand: item.onHand + quantity } : item
      )));
      setSelected((current) => current ? { ...current, onHand: current.onHand + quantity } : current);
      setMessageKind("success"); setMessage("Stock adjustment recorded in the movement ledger.");
      (event.target as HTMLFormElement).reset();
    } catch (error) {
      setMessage(warehouseError(error, "Unable to adjust stock."));
    } finally { mutationLock.current = false; setBusy(false); }
  }

  async function removeProduct(row: InventoryRow) {
    try {
      const { error } = await (supabase.from("products") as any)
        .delete()
        .eq("id", row.id)
        .eq("org_id", orgId);
      if (error) throw error;
      setItems((current) => current.filter((item) => item.id !== row.id));
      setMessage("SKU deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to delete this SKU. SKUs with stock cannot be deleted.");
    }
  }

  const locationDistribution = selected ? (
    <section>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-graphite">Location distribution</p>
        <span className="rounded-full bg-rack/10 px-2 py-1 text-xs font-semibold text-rack">
          {stockLoading ? "Loading…" : `${stockTotal} ${stockTotal === 1 ? "location" : "locations"}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-graphite">
        Quarantine stock is physically held in the bin shown, but is excluded from available-to-sell stock.
      </p>
      <div className="mt-3 space-y-3">
        {stockLoading ? <p role="status" className="text-sm text-graphite">Loading location balances…</p> : stockByLocation.length ? stockByLocation.map((stock) => <article key={stock.locationId} className="rounded-lg border border-line p-4">
          <p className="break-words font-semibold">{stock.warehouseName && !/^unknown/i.test(stock.warehouseName) ? stock.warehouseName : "[Unassigned warehouse]"}</p>
          <p className="mt-1 break-words text-sm text-graphite">{stock.zoneCode && !/^unknown/i.test(stock.zoneCode) ? stock.zoneCode : "[Unassigned zone]"} · <span className="code-label font-medium text-ink">{stock.locationCode && !/^unknown/i.test(stock.locationCode) ? stock.locationCode : "[Unassigned bin]"}</span></p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">{[
            ["Available", stock.available, "text-go"], ["Reserved", stock.reserved, "text-amber-dark"],
            ["Inbound", stock.inbound, "text-rack"], ["Quarantine", stock.quarantined, "text-alert"], ["On hand", stock.onHand, "text-ink"],
          ].map(([label, count, color]) => <div key={String(label)} className="rounded bg-paper p-2"><dt className="text-xs text-graphite">{label}</dt><dd className={`mt-1 text-lg font-semibold ${color}`}>{count}</dd></div>)}</dl>
          {selected.is_serialized ? <details className="mt-3 text-sm"><summary className="min-h-11 cursor-pointer py-3 font-medium">In-stock serial numbers ({stock.serialNumbers.length})</summary><div className="max-h-48 overflow-y-auto break-all code-label">{stock.serialNumbers.join(" · ") || "No in-stock serials at this location."}</div></details> : <p className="mt-3 text-xs text-graphite">Not serialized</p>}
        </article>) : <p className="rounded-lg border border-dashed border-line p-4 text-sm text-graphite">No stock at any location.</p>}
        {stockTotal > stockByLocation.length && <p className="text-xs text-graphite">Showing {stockByLocation.length} of {stockTotal} locations.</p>}
      </div>
    </section>
  ) : null;

  return (
    <>
      <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel">
        <div className="overflow-x-auto">
          <table className="mobile-cards w-full min-w-[1040px] text-sm">
            <thead className="sticky top-0 z-10 bg-paper text-left text-[11px] uppercase tracking-wide text-graphite">
              <tr>
                <th className="px-5 py-3">Product</th>
                <th className="px-5 py-3">SKU / barcode</th>
                <th className="px-5 py-3 text-right">On hand</th>
                <th className="px-5 py-3 text-right">Reserved</th>
                <th className="px-5 py-3 text-right">Available</th>
                <th className="px-5 py-3 text-right">Quarantine</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const available = row.onHand - row.reserved;
                const low = available < 5;
                return (
                  <tr key={row.id} className="border-t border-line transition hover:bg-paper/70">
                    <td data-label="Product" className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-9 w-9 items-center justify-center rounded-md bg-rack/10 text-rack"><Package size={18} /></span>
                        <span>
                          <span className="font-medium">{row.name}</span>
                          {row.is_serialized && <span className="ml-2 inline-flex rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-700 ring-1 ring-inset ring-violet-200">Serialized</span>}
                          <button type="button" onClick={() => open("view", row)} className="ml-2 rounded-full bg-rack/10 px-2 py-0.5 text-[10px] font-semibold text-rack hover:bg-rack/20">
                            Stored in {row.locations} {row.locations === 1 ? "location" : "locations"}
                          </button>
                        </span>
                      </div>
                    </td>
                    <td data-label="SKU / barcode" className="px-5 py-3">
                      <div className="code-label text-xs">{row.sku}</div>
                      <div className="code-label mt-1 text-xs text-graphite">{row.barcode}</div>
                    </td>
                    <td data-label="On hand" className="px-5 py-3 text-right font-medium">{row.onHand} {row.unit_of_measure}</td>
                    <td data-label="Reserved" className="px-5 py-3 text-right text-graphite">{row.reserved}</td>
                    <td data-label="Available" className={`px-5 py-3 text-right font-semibold ${low ? "text-alert" : "text-go"}`}>{available}</td>
                    <td data-label="Quarantine" className={`px-5 py-3 text-right font-semibold ${row.quarantined ? "text-alert" : "text-graphite"}`}>{row.quarantined || "—"}</td>
                    <td data-label="Status" className="px-5 py-3">{low ? <StatusBadge status="LOW" /> : <StatusBadge status="ACTIVE" />}</td>
                    <td data-label="Actions" className="px-5 py-3">
                      <RowActions
                        onView={() => open("view", row)}
                        onEdit={canManage ? () => open("edit", row) : undefined}
                        onAdjust={canManage ? () => open("adjust", row) : undefined}
                        onDelete={canManage ? () => removeProduct(row) : undefined}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <PageNavigation page={page} pageSize={50} total={total} />
      </div>

      {mode === null && <WorkflowNotice notice={message ? { kind: messageKind, text: message } : null} />}

      <Drawer
        open={mode !== null}
        onClose={close}
        title={mode === "view" ? "SKU details" : mode === "edit" ? "Edit SKU" : "Adjust stock"}
        description={selected ? `${selected.sku} · ${selected.name}` : undefined}
      >
        <WorkflowNotice notice={message ? { kind: messageKind, text: message } : null} />
        {selected && mode === "view" && (
          <div className="space-y-6">
            <section>
              <p className="text-xs font-semibold uppercase tracking-wide text-graphite">Product specifications</p>
              <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-graphite">SKU</dt><dd className="code-label mt-1">{selected.sku}</dd></div>
                <div><dt className="text-graphite">Barcode</dt><dd className="code-label mt-1">{selected.barcode}</dd></div>
                <div><dt className="text-graphite">Unit price</dt><dd className="mt-1">{Number(selected.price ?? 0).toFixed(2)}</dd></div>
                <div><dt className="text-graphite">Available</dt><dd className="mt-1 font-semibold text-go">{selected.onHand - selected.reserved}</dd></div>
                <div><dt className="text-graphite">Quarantined</dt><dd className="mt-1 font-semibold text-alert">{selected.quarantined}</dd></div>
                <div><dt className="text-graphite">Tracking</dt><dd className="mt-1">{selected.is_serialized ? <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">Serialized</span> : "Standard"}</dd></div>
              </dl>
              {selected.description && <p className="mt-4 whitespace-pre-wrap text-sm text-graphite">{selected.description}</p>}
            </section>
            {locationDistribution}
            {selected.is_serialized && (
              <section>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-graphite">Available serial numbers</p>
                  <span className="rounded-full bg-violet-50 px-2 py-1 text-xs font-semibold text-violet-700">{serialTotal} in stock</span>
                </div>
                <div className="mt-2 rounded-md border border-line bg-paper p-3">
                  {stockLoading ? <p className="text-sm text-graphite">Loading serial numbers…</p> : availableSerials.length ? (
                    <div className="flex flex-wrap gap-2">
                      {availableSerials.map((serial) => (
                        <span key={serial.serialNumber} className="inline-flex items-center gap-1 rounded bg-panel px-2 py-1 text-xs ring-1 ring-inset ring-violet-200">
                          <span className="code-label font-medium">{serial.serialNumber}</span>
                          <span className="text-graphite">· {serial.locationCode}</span>
                        </span>
                      ))}
                    </div>
                  ) : <p className="text-sm text-graphite">No active serial numbers are currently in stock.</p>}
                </div>
              </section>
            )}
          </div>
        )}

        {selected && mode === "edit" && (
          <form onSubmit={saveProduct} className="space-y-4">
            <p className="rounded-md bg-paper px-3 py-2 text-sm text-graphite">Product ID <span className="code-label font-medium text-ink">{selected.sku}</span> is assigned automatically and cannot be changed.</p>
            {locationDistribution}
            <label className="block text-sm">Product name<input name="name" required defaultValue={selected.name} className="input-field mt-1" /></label>
            <label className="block text-sm">Barcode<input name="barcode" required defaultValue={selected.barcode} className="input-field mt-1 code-label" /></label>
            <label className="block text-sm">Description<textarea name="description" defaultValue={selected.description ?? ""} className="input-field mt-1 min-h-20" /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Unit price<input name="price" type="number" min="0" step="0.01" defaultValue={selected.price ?? 0} className="input-field mt-1" /></label>
              <label className="block text-sm">Unit of measure<input name="uom" required defaultValue={selected.unit_of_measure} className="input-field mt-1" /></label>
            </div>
            <label className="flex items-start gap-3 rounded-md border border-line bg-paper p-3 text-sm">
              <input name="isSerialized" type="checkbox" defaultChecked={selected.is_serialized} className="mt-0.5" />
              <span><span className="font-medium">Is serialized item?</span><span className="mt-0.5 block text-xs text-graphite">Changing this affects future receipts. Existing on-hand stock is not converted into serial records.</span></span>
            </label>
            <div className="flex justify-end gap-2 border-t border-line pt-5">
              <button type="button" onClick={close} className="btn-secondary">Close</button>
              <button disabled={busy} className="btn-primary">{busy ? "Saving…" : "Save changes"}</button>
            </div>
          </form>
        )}

        {selected && mode === "adjust" && (
          <form onSubmit={adjustStock} className="space-y-4">
            {selected.is_serialized && <WorkflowNotice notice={{ kind: "error", text: "Use serial-aware receiving or returns to change serialized stock. Quantity-only adjustments are blocked." }} />}
            <p className="rounded-md border border-amber/30 bg-amber/10 p-3 text-sm text-graphite">Adjustments are audited. Use a positive number to add stock and a negative number to remove it.</p>
            <div className="flex gap-2">
              <label className="block flex-1 text-sm">Find bin<input value={locationQuery} onChange={(event) => setLocationQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void loadLocations(locationQuery); } }} placeholder="Search bin code" className="input-field mt-1" /></label>
              <button type="button" onClick={() => void loadLocations(locationQuery)} disabled={locationsLoading} className="btn-secondary mt-6">{locationsLoading ? "Loading…" : "Search"}</button>
            </div>
            <label className="block text-sm">Bin location
              <select key={locations.map((bin) => bin.id).join(",")} name="locationId" defaultValue={locations[0]?.id ?? ""} required className="input-field mt-1" disabled={locationsLoading}>
                <option value="">{locationsLoading ? "Loading bins…" : "Select bin…"}</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{binLabel(location)}</option>)}
              </select>
            </label>
            <label className="block text-sm">Quantity change<input name="quantity" type="number" step="1" required className="input-field mt-1" /></label>
            <label className="block text-sm">Reason<textarea name="reason" required className="input-field mt-1 min-h-20" /></label>
            <div className="flex justify-end gap-2 border-t border-line pt-5">
              <button type="button" onClick={close} className="btn-secondary">Cancel</button>
              <button disabled={busy || selected.is_serialized || !locations.length} className="btn-primary">{busy ? "Saving…" : "Record adjustment"}</button>
            </div>
          </form>
        )}
      </Drawer>
    </>
  );
}
