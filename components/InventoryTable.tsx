"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Package } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Drawer } from "@/components/ui/Drawer";
import { RowActions } from "@/components/ui/RowActions";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { PageNavigation } from "@/components/ui/PageNavigation";

type StockByLocation = { locationCode: string; onHand: number; reserved: number };
type Row = { id: string; sku: string; barcode: string; name: string; unit_of_measure: string; onHand: number; reserved: number; locations: number; stockByLocation?: StockByLocation[] };
type Location = { id: string; display_code?: string; location_code: string };
type Mode = "view" | "edit" | "adjust" | null;

export function InventoryTable({ orgId, rows, locations, canManage, page, total }: { orgId: string; rows: Row[]; locations: Location[]; canManage: boolean; page: number; total: number }) {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState(rows);
  const [selected, setSelected] = useState<Row | null>(null);
  const [mode, setMode] = useState<Mode>(null);
  const [message, setMessage] = useState("");
  useEffect(() => { setItems(rows); }, [rows]);
  const open = (next: Exclude<Mode, null>, row: Row) => { setSelected(row); setMode(next); setMessage(""); };
  const close = () => { setMode(null); setSelected(null); };

  async function saveProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    try {
      const form = new FormData(event.currentTarget);
      const patch = { barcode: String(form.get("barcode") ?? "").trim(), name: String(form.get("name") ?? "").trim(), unit_of_measure: String(form.get("uom") ?? "PCS").trim() || "PCS" };
      const { error } = await (supabase.from("products") as any).update(patch).eq("id", selected.id).eq("org_id", orgId);
      if (error) throw error;
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, ...patch } : item));
      setSelected((current) => current ? { ...current, ...patch } : current);
      setMessage("SKU details saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save the SKU."); }
  }

  async function adjustStock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    try {
      const form = new FormData(event.currentTarget);
      const quantity = Number(form.get("quantity"));
      if (!Number.isInteger(quantity) || quantity === 0) throw new Error("Enter a whole-number adjustment other than zero.");
      const { error } = await (supabase.rpc as any)("apply_stock_adjustment", { p_org_id: orgId, p_product_id: selected.id, p_location_id: form.get("locationId"), p_quantity_delta: quantity, p_reason: String(form.get("reason") ?? "").trim() || "Manual stock adjustment" });
      if (error) throw error;
      setItems((current) => current.map((item) => item.id === selected.id ? { ...item, onHand: item.onHand + quantity } : item));
      setSelected((current) => current ? { ...current, onHand: current.onHand + quantity } : current);
      setMessage("Stock adjustment recorded in the movement ledger.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to adjust stock."); }
  }

  async function removeProduct(row: Row) {
    try {
      const { error } = await (supabase.from("products") as any).delete().eq("id", row.id).eq("org_id", orgId);
      if (error) throw error;
      setItems((current) => current.filter((item) => item.id !== row.id));
      setMessage("SKU deleted.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to delete this SKU. SKUs with stock cannot be deleted."); }
  }

  return <>
    <div className="mt-6 overflow-hidden rounded-lg border border-line bg-panel"><div className="overflow-x-auto"><table className="w-full min-w-[920px] text-sm"><thead className="sticky top-0 z-10 bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-5 py-3">Product</th><th className="px-5 py-3">SKU / barcode</th><th className="px-5 py-3 text-right">On hand</th><th className="px-5 py-3 text-right">Reserved</th><th className="px-5 py-3 text-right">Available</th><th className="px-5 py-3">Status</th><th className="px-5 py-3"/></tr></thead><tbody>{items.map((row) => { const available = row.onHand - row.reserved; const low = available < 5; return <tr key={row.id} className="border-t border-line transition hover:bg-paper/70"><td className="px-5 py-3"><div className="flex items-center gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-md bg-rack/10 text-rack"><Package size={18}/></span><span className="font-medium">{row.name}</span></div></td><td className="px-5 py-3"><div className="code-label text-xs">{row.sku}</div><div className="code-label mt-1 text-xs text-graphite">{row.barcode}</div></td><td className="px-5 py-3 text-right font-medium">{row.onHand} {row.unit_of_measure}</td><td className="px-5 py-3 text-right text-graphite">{row.reserved}</td><td className={`px-5 py-3 text-right font-semibold ${low ? "text-alert" : "text-go"}`}>{available}</td><td className="px-5 py-3">{low ? <StatusBadge status="LOW"/> : <StatusBadge status="ACTIVE"/>}</td><td className="px-5 py-3"><RowActions onView={() => open("view", row)} onEdit={canManage ? () => open("edit", row) : undefined} onAdjust={canManage ? () => open("adjust", row) : undefined} onDelete={canManage ? () => removeProduct(row) : undefined}/></td></tr>; })}</tbody></table></div><PageNavigation page={page} pageSize={50} total={total}/></div>
    {message && <p role="alert" className="mt-3 text-sm text-alert">{message}</p>}
    <Drawer open={mode !== null} onClose={close} title={mode === "view" ? "SKU details" : mode === "edit" ? "Edit SKU" : "Adjust stock"} description={selected ? `${selected.sku} · ${selected.name}` : undefined}>
      {selected && mode === "view" && <div className="space-y-6"><section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Product specifications</p><dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-graphite">SKU</dt><dd className="code-label mt-1">{selected.sku}</dd></div><div><dt className="text-graphite">Barcode</dt><dd className="code-label mt-1">{selected.barcode}</dd></div><div><dt className="text-graphite">UOM</dt><dd className="mt-1">{selected.unit_of_measure}</dd></div><div><dt className="text-graphite">Available</dt><dd className="mt-1 font-semibold">{selected.onHand - selected.reserved}</dd></div></dl></section><section><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Stock by bin</p><div className="mt-2 overflow-hidden rounded-md border border-line">{(selected.stockByLocation ?? []).length ? selected.stockByLocation?.map((stock) => <div key={stock.locationCode} className="flex justify-between border-b border-line px-4 py-3 text-sm last:border-0"><span className="code-label">{stock.locationCode}</span><span>{stock.onHand} on hand · {stock.reserved} reserved</span></div>) : <p className="px-4 py-3 text-sm text-graphite">No stock is held in a bin.</p>}</div></section></div>}
      {selected && mode === "edit" && <form onSubmit={saveProduct} className="space-y-4"><p className="rounded-md bg-paper px-3 py-2 text-sm text-graphite">Product ID <span className="code-label font-medium text-ink">{selected.sku}</span> is assigned automatically and cannot be changed.</p><label className="block text-sm">Product name<input name="name" required defaultValue={selected.name} className="input-field mt-1"/></label><label className="block text-sm">Barcode<input name="barcode" required defaultValue={selected.barcode} className="input-field mt-1 code-label"/></label><label className="block text-sm">Unit of measure<input name="uom" required defaultValue={selected.unit_of_measure} className="input-field mt-1"/></label>{message && <p role="alert" className="text-sm text-alert">{message}</p>}<div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" onClick={close} className="btn-secondary">Close</button><button className="btn-primary">Save changes</button></div></form>}
      {selected && mode === "adjust" && <form onSubmit={adjustStock} className="space-y-4"><p className="rounded-md border border-amber/30 bg-amber/10 p-3 text-sm text-graphite">Adjustments are audited. Use a positive number to add stock and a negative number to remove it.</p><label className="block text-sm">Bin location<select name="locationId" required className="input-field mt-1"><option value="">Select bin…</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.display_code ?? "LOC?"} · {location.location_code}</option>)}</select></label><label className="block text-sm">Quantity change<input name="quantity" type="number" step="1" required className="input-field mt-1"/></label><label className="block text-sm">Reason<textarea name="reason" required className="input-field mt-1 min-h-20"/></label>{message && <p role="alert" className="text-sm text-alert">{message}</p>}<div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" onClick={close} className="btn-secondary">Cancel</button><button className="btn-primary">Record adjustment</button></div></form>}
    </Drawer>
  </>;
}
