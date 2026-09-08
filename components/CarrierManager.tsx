"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { KeyRound, Pencil, Plus, ShieldCheck, Truck } from "lucide-react";
import { Drawer } from "@/components/ui/Drawer";

type CarrierCode = "MANUAL" | "DHL_EXPRESS" | "NINJA_VAN";
type Carrier = {
  id: string;
  carrier_code: CarrierCode;
  display_name: string;
  is_active: boolean;
  is_sandbox: boolean;
  created_at?: string;
  updated_at?: string;
};
type FormState = {
  id?: string;
  carrierCode: CarrierCode;
  displayName: string;
  isActive: boolean;
  isSandbox: boolean;
  apiKey: string;
  apiSecret: string;
  accountNumber: string;
  clientId: string;
  webhookSecret: string;
};

const carrierNames: Record<CarrierCode, string> = { MANUAL: "Manual shipment", DHL_EXPRESS: "DHL Express", NINJA_VAN: "Ninja Van" };
const emptyForm = (): FormState => ({ carrierCode: "MANUAL", displayName: "Manual shipment", isActive: false, isSandbox: true, apiKey: "", apiSecret: "", accountNumber: "", clientId: "", webhookSecret: "" });

export function CarrierManager({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [carriers, setCarriers] = useState<Carrier[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const availableCodes = useMemo(() => (Object.keys(carrierNames) as CarrierCode[]).filter((code) => !carriers.some((carrier) => carrier.carrier_code === code)), [carriers]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/carriers?orgId=${encodeURIComponent(orgId)}`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load carrier settings.");
      setCarriers(result.carriers ?? []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to load carrier settings."); }
    finally { setLoading(false); }
  }, [orgId]);

  useEffect(() => { void load(); }, [load]);
  function setField<K extends keyof FormState>(key: K, value: FormState[K]) { setForm((current) => ({ ...current, [key]: value })); }
  function openCreate() {
    const code = availableCodes[0];
    if (!code) return setMessage("All supported carriers are already configured. Edit an existing carrier to change its settings.");
    setForm({ ...emptyForm(), carrierCode: code, displayName: carrierNames[code] }); setMessage(""); setOpen(true);
  }
  function openEdit(carrier: Carrier) {
    // Secrets are intentionally not returned to the browser. Empty credential
    // inputs mean “retain the existing encrypted value”.
    setForm({ ...emptyForm(), id: carrier.id, carrierCode: carrier.carrier_code, displayName: carrier.display_name, isActive: carrier.is_active, isSandbox: carrier.is_sandbox }); setMessage(""); setOpen(true);
  }
  function selectCarrier(code: CarrierCode) { setForm((current) => ({ ...current, carrierCode: code, displayName: current.displayName === carrierNames[current.carrierCode] ? carrierNames[code] : current.displayName })); }
  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/carriers", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId, id: form.id, carrierCode: form.carrierCode, displayName: form.displayName, isActive: form.isActive, isSandbox: form.isSandbox, credentials: { apiKey: form.apiKey, apiSecret: form.apiSecret, accountNumber: form.accountNumber, clientId: form.clientId, webhookSecret: form.webhookSecret } }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to save carrier settings.");
      setOpen(false); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save carrier settings."); }
    finally { setSaving(false); }
  }

  const manual = form.carrierCode === "MANUAL";
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-graphite">Configure organization-scoped carriers for <span className="font-medium text-ink">{orgName}</span>.</p><p className="mt-1 text-xs text-graphite">Credentials are AES-256-GCM encrypted on the server and are never displayed again.</p></div><button onClick={openCreate} className="btn-primary"><Plus size={16} />Add carrier</button></div>
    {message && <p role="alert" className="text-sm text-alert">{message}</p>}
    {loading ? <div className="rounded-lg border border-line bg-panel p-6 text-sm text-graphite">Loading carrier settings…</div> : <div className="grid gap-4 lg:grid-cols-2">{carriers.map((carrier) => <article key={carrier.id} className="rounded-xl border border-line bg-panel p-5 shadow-sm"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><div className="rounded-lg bg-rack/10 p-2.5 text-rack"><Truck size={20} /></div><div><h2 className="font-semibold">{carrier.display_name}</h2><p className="code-label mt-0.5 text-xs text-graphite">{carrier.carrier_code}</p></div></div><button onClick={() => openEdit(carrier)} className="btn-secondary px-3 py-2" aria-label={`Configure ${carrier.display_name}`}><Pencil size={15} />Configure</button></div><div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm"><div><p className="text-xs uppercase tracking-wide text-graphite">Environment</p><p className={`mt-1 font-medium ${carrier.is_sandbox ? "text-amber-dark" : "text-go"}`}>{carrier.is_sandbox ? "Sandbox / testing" : "Production"}</p></div><div><p className="text-xs uppercase tracking-wide text-graphite">Status</p><p className={`mt-1 font-medium ${carrier.is_active ? "text-go" : "text-graphite"}`}>{carrier.is_active ? "Enabled" : "Disabled"}</p></div></div></article>)}{!carriers.length && <div className="rounded-xl border border-dashed border-line bg-panel p-8 text-center lg:col-span-2"><Truck size={26} className="mx-auto text-graphite" /><p className="mt-3 font-medium">No carriers configured</p><p className="mt-1 text-sm text-graphite">Add DHL Express or Ninja Van to make it available in Sales Order dispatch.</p></div>}</div>}
    <Drawer open={open} onClose={() => !saving && setOpen(false)} title={form.id ? "Configure carrier" : "Add carrier"} description={manual ? "Manual shipments use a WMS-generated AWB and printable label; no API credentials are needed." : "Credentials are stored encrypted and cannot be viewed after saving."}><form onSubmit={save} className="space-y-5"><section className="space-y-4"><label className="block text-sm font-medium">Carrier<select disabled={Boolean(form.id)} value={form.carrierCode} onChange={(event) => selectCarrier(event.target.value as CarrierCode)} className="input-field mt-1 disabled:cursor-not-allowed disabled:bg-paper"><option value="MANUAL">Manual shipment</option><option value="DHL_EXPRESS">DHL Express</option><option value="NINJA_VAN">Ninja Van</option></select></label><label className="block text-sm font-medium">Display name<input required maxLength={100} value={form.displayName} onChange={(event) => setField("displayName", event.target.value)} className="input-field mt-1" /></label><div className="grid gap-3 sm:grid-cols-2">{!manual && <label className="flex items-center gap-2 rounded-md border border-line p-3 text-sm"><input type="checkbox" checked={form.isSandbox} onChange={(event) => setField("isSandbox", event.target.checked)} />Sandbox / testing</label>}<label className="flex items-center gap-2 rounded-md border border-line p-3 text-sm"><input type="checkbox" checked={form.isActive} onChange={(event) => setField("isActive", event.target.checked)} />Enabled for dispatch</label></div></section>{manual ? <section className="rounded-lg border border-rack/20 bg-rack/5 p-4 text-sm"><p className="font-medium">No API connection required</p><p className="mt-1 text-graphite">Use this for self-delivery, third-party carriers without an API, or shipments booked outside the WMS. The system records the manual AWB, ships inventory, and provides a printable label.</p></section> : <><section className="rounded-lg border border-rack/20 bg-rack/5 p-4"><div className="flex gap-2"><KeyRound size={17} className="mt-0.5 text-rack" /><div><p className="text-sm font-medium">Carrier credentials</p><p className="mt-1 text-xs text-graphite">For an existing carrier, leave a field blank to retain its stored value. Production dispatch requires API key and secret.</p></div></div><div className="mt-4 grid gap-3"><label className="block text-sm">API key<input autoComplete="off" value={form.apiKey} onChange={(event) => setField("apiKey", event.target.value)} className="input-field mt-1" /></label><label className="block text-sm">API secret / token<input type="password" autoComplete="new-password" value={form.apiSecret} onChange={(event) => setField("apiSecret", event.target.value)} className="input-field mt-1" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Account number<input autoComplete="off" value={form.accountNumber} onChange={(event) => setField("accountNumber", event.target.value)} className="input-field mt-1" /></label><label className="block text-sm">Client ID<input autoComplete="off" value={form.clientId} onChange={(event) => setField("clientId", event.target.value)} className="input-field mt-1" /></label></div><label className="block text-sm">Webhook HMAC secret<input type="password" autoComplete="new-password" value={form.webhookSecret} onChange={(event) => setField("webhookSecret", event.target.value)} className="input-field mt-1" /></label></div></section><section className="rounded-md border border-line bg-paper p-3 text-xs text-graphite"><span className="inline-flex items-center gap-1 font-medium text-ink"><ShieldCheck size={14} />Webhook endpoint</span><code className="mt-2 block break-all code-label">/api/webhooks/carriers/{form.carrierCode}</code><p className="mt-2">Configure your provider to send an HMAC SHA-256 signature in <code>x-proconnect-webhook-signature</code>.</p></section></>}{message && <p role="alert" className="text-sm text-alert">{message}</p>}<div className="flex justify-end gap-2 border-t border-line pt-5"><button type="button" disabled={saving} onClick={() => setOpen(false)} className="btn-secondary">Cancel</button><button disabled={saving} className="btn-primary">{saving ? "Saving…" : "Save carrier"}</button></div></form></Drawer>
  </div>;
}
