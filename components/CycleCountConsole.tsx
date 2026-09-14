"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { WorkflowNotice, type Notice } from "@/components/ui/WorkflowNotice";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Drawer } from "@/components/ui/Drawer";
import { binLabel, warehouseError } from "@/lib/warehouse-ui";
type Item = { id: string; sku: string; name: string };
type Bin = { id: string; location_code: string; display_code?: string };
type Count = { id: string; count_number: string; status: string; cycle_count_items?: { id: string; system_quantity: number; physical_quantity: number; reason_code: string; products?: { sku: string; name: string }; locations?: Bin }[] };

export function CycleCountConsole({ orgId, products, bins }: { orgId: string; products: Item[]; bins: Bin[] }) {
  const [productId, setProductId] = useState("");
  const [locationId, setLocationId] = useState(bins[0]?.id ?? "");
  const [count, setCount] = useState("");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<Notice>(null);
  const [rows, setRows] = useState<Count[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Count | null>(null);
  const lock = useRef(false);
  const countInput = useRef<HTMLInputElement>(null);
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/exceptions?orgId=${encodeURIComponent(orgId)}&view=cycleCounts`, { signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load count queue.");
      if (!signal?.aborted) setRows(result.cycleCounts ?? []);
    } catch (error) { if (!signal?.aborted) setNotice({ kind: "error", text: warehouseError(error, "Unable to load count queue.") }); }
    finally { if (!signal?.aborted) setLoading(false); }
  }, [orgId]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  async function action(payload: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice(null);
    try {
      const response = await fetch("/api/exceptions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save cycle count.");
      setNotice({ kind: "success", text: payload.action === "submitCycleCount" ? "Count submitted for review. Inventory is unchanged until approval." : payload.approve ? "Count approved and recorded in the inventory ledger." : "Count rejected. Inventory was not changed." });
      if (payload.action === "submitCycleCount") { setCount(""); setReason(""); countInput.current?.focus(); }
      setSelected(null);
      await load();
    } catch (error) { setNotice({ kind: "error", text: warehouseError(error, "Unable to save the count. Review its status before retrying if the connection was interrupted.") }); }
    finally { lock.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!productId || !bins.some((bin) => bin.id === locationId) || !count.trim() || !Number.isSafeInteger(Number(count)) || Number(count) < 0) {
      setNotice({ kind: "error", text: "Select a SKU and active bin, then enter a whole physical count. Enter 0 only if the bin is actually empty for this SKU." }); return;
    }
    void action({ action: "submitCycleCount", lines: [{ productId, locationId, physicalQuantity: Number(count), reasonCode: reason || null }] });
  }
  return <div className="space-y-6">
    <WorkflowNotice notice={notice} />
    <form onSubmit={submit} className="rounded-xl border border-line bg-panel p-4 sm:p-6">
      <h2 className="text-lg font-semibold">Blind bin count</h2>
      <p className="mt-1 text-sm text-graphite">Count physical units in the selected bin. The system quantity stays hidden while you count. If a discrepancy is detected, you must select a reason before submission succeeds.</p>
      <fieldset disabled={busy} className="mt-5 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-medium">Bin<select required value={locationId} onChange={(event) => { setLocationId(event.target.value); setCount(""); setReason(""); }} className="input-field mt-1">{!bins.length && <option value="">No active bins</option>}{bins.map((bin) => <option key={bin.id} value={bin.id}>{binLabel(bin)}</option>)}</select></label>
        <label className="text-sm font-medium">SKU<select required value={productId} onChange={(event) => { setProductId(event.target.value); setCount(""); setReason(""); countInput.current?.focus(); }} className="input-field mt-1"><option value="">Select SKU…</option>{products.map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}</select></label>
        <label className="text-sm font-medium">Physical count<input ref={countInput} required inputMode="numeric" type="number" step="1" min="0" value={count} onChange={(event) => setCount(event.target.value)} placeholder="Count units in this bin" className="input-field mt-1" /></label>
        <label className="text-sm font-medium">Discrepancy reason<select value={reason} onChange={(event) => setReason(event.target.value)} className="input-field mt-1"><option value="">No discrepancy identified</option><option value="DAMAGED">Damaged</option><option value="MISSING">Missing</option><option value="MISPLACED">Misplaced</option><option value="COUNT_ERROR">Count error</option><option value="OTHER">Other</option></select></label>
      </fieldset>
      {!bins.length && <WorkflowNotice notice={{ kind: "error", text: "Create an active bin in Locations before counting inventory." }} />}
      <button disabled={busy || !bins.length} className="btn-primary mt-5">{busy ? "Saving…" : "Submit count for approval"}</button>
    </form>
    <section className="rounded-xl border border-line bg-panel p-4 sm:p-6"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">Count review queue</h2><button type="button" disabled={loading || busy} onClick={() => void load()} className="btn-secondary">Refresh</button></div>
      {loading ? <p role="status" className="mt-4 text-sm text-graphite">Loading counts…</p> : rows.length ? rows.map((row) => <div key={row.id} className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3 text-sm"><span className="code-label font-medium">{row.count_number}</span><StatusBadge status={row.status} /><button type="button" onClick={() => setSelected(row)} className="btn-secondary">Review details</button></div>) : <p className="mt-4 text-sm text-graphite">No counts submitted yet.</p>}
    </section>
    <Drawer open={selected !== null} onClose={() => !busy && setSelected(null)} title="Review cycle count" description={selected?.count_number}>
      {selected && <div className="space-y-4"><WorkflowNotice notice={notice?.kind === "error" ? notice : null} />{selected.cycle_count_items?.map((line) => <article key={line.id} className="rounded-lg border border-line p-4"><p className="font-medium">{line.products?.sku} · {line.products?.name}</p><p className="mt-1 text-sm text-graphite">{binLabel(line.locations)}</p><dl className="mt-3 grid grid-cols-3 gap-2 text-sm"><div><dt>System</dt><dd className="font-semibold">{line.system_quantity}</dd></div><div><dt>Counted</dt><dd className="font-semibold">{line.physical_quantity}</dd></div><div><dt>Difference</dt><dd className="font-semibold text-alert">{line.physical_quantity - line.system_quantity}</dd></div></dl><p className="mt-3 text-sm">Reason: {line.reason_code?.replace(/_/g, " ") || "No discrepancy"}</p></article>)}{selected.status === "PENDING_APPROVAL" && <><WorkflowNotice notice={{ kind: "info", text: "Approval changes inventory. Verify the SKU, bin, difference and reason before approving." }} /><div className="flex justify-end gap-2"><button disabled={busy} onClick={() => void action({ action: "approveCycleCount", cycleCountId: selected.id, approve: false })} className="btn-secondary">Reject</button><button disabled={busy} onClick={() => void action({ action: "approveCycleCount", cycleCountId: selected.id, approve: true })} className="btn-primary">Approve adjustment</button></div></>}</div>}
    </Drawer>
  </div>;
}
