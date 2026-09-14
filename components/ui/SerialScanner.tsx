"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ScanLine, X } from "lucide-react";
import { appendSerials, serialTokens } from "@/lib/warehouse-ui";
import { WorkflowNotice } from "./WorkflowNotice";

/** A scanner's Enter/Tab suffix commits a scan, never the enclosing stock form. */
export function SerialScanner({ serials, quantity, onChange, disabled = false, label = "Scan serial numbers" }: { serials: string[]; quantity: number; onChange: (values: string[]) => void; disabled?: boolean; label?: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const current = useRef(serials);
  current.current = serials;
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { input.current?.focus(); }, []);
  function commit(value = draft) {
    if (disabled) return;
    const batch = serialTokens(value);
    if (!batch.length) return;
    try {
      const next = appendSerials(current.current, batch, quantity);
      current.current = next;
      onChange(next);
      setDraft(""); setError("");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to add serials."); }
    input.current?.focus();
    input.current?.select();
  }
  return <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><label htmlFor={id} className="font-medium">{label}</label><span role="status" className={`rounded-full px-3 py-1 text-sm font-semibold ${serials.length === quantity ? "bg-emerald-100 text-go" : "bg-amber/20 text-amber-dark"}`}>{serials.length} / {Number.isSafeInteger(quantity) ? quantity : 0}</span></div>
    <div className="mt-3 flex gap-2"><div className="relative min-w-0 flex-1"><ScanLine size={18} className="absolute left-3 top-3.5 text-graphite" /><input id={id} ref={input} data-autofocus value={draft} disabled={disabled} autoComplete="off" autoCapitalize="characters" spellCheck={false} enterKeyHint="done" onChange={(event) => { const value = event.target.value; setDraft(value); if (/[\r\n,;\t]/.test(value)) commit(value); }} onKeyDown={(event) => { if (event.key === "Enter" || (event.key === "Tab" && draft.trim())) { event.preventDefault(); commit(); } }} placeholder="Scan serial, then Enter" className="input-field pl-10" /></div><button type="button" disabled={disabled} onClick={() => commit()} className="btn-secondary">Add</button></div>
    <WorkflowNotice notice={error ? { kind: "error", text: error } : null} />
    <p className="mt-2 text-xs text-graphite">Enter or Tab adds one scan. You can also paste a comma-separated list. Exact PO/SO and bin eligibility is checked when you confirm.</p>
    {serials.length > 0 && <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto">{serials.map((serial) => <li key={serial} className="flex items-center justify-between gap-2 rounded-md bg-panel pl-3 text-sm"><span className="code-label min-w-0 break-all">{serial}</span><button type="button" disabled={disabled} onClick={() => { const next = current.current.filter((item) => item !== serial); current.current = next; onChange(next); setError(""); input.current?.focus(); }} aria-label={`Remove ${serial}`} className="flex h-11 w-11 shrink-0 items-center justify-center text-alert"><X size={18} /></button></li>)}</ul>}
  </section>;
}
