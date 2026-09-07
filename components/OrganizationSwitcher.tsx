"use client";
import { Building2, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrganizationContext } from "@/lib/org";
export function OrganizationSwitcher({ organizations, activeId }: { organizations: OrganizationContext[]; activeId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const active = organizations.find((org) => org.id === activeId);
  const label = (org: OrganizationContext) => `${org.code ?? "ORG"} · ${org.name}`;
  if (organizations.length < 2) return <div className="flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm"><Building2 size={16} className="text-rack"/><span className="font-medium">{active ? label(active) : "Organization"}</span></div>;
  return <div className="relative"><label className="flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm"><Building2 size={16} className="text-rack"/><select value={activeId} disabled={busy} onChange={async event => { setBusy(true); setMessage(""); try { const response = await fetch("/api/org-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: event.target.value }) }); if (!response.ok) throw new Error((await response.json()).error ?? "Unable to switch organization."); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to switch organization."); } finally { setBusy(false); } }} className="appearance-none bg-transparent pr-5 font-medium outline-none"><option value={activeId}>{active ? label(active) : "Organization"}</option>{organizations.filter(org => org.id !== activeId).map(org => <option key={org.id} value={org.id}>{label(org)}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-2 text-graphite"/></label>{message && <p role="alert" className="absolute right-0 top-full z-20 mt-1 w-64 rounded border border-alert/30 bg-panel p-2 text-xs text-alert">{message}</p>}</div>;
}
