"use client";
import { Building2, ChevronDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { OrganizationContext } from "@/lib/org";
export function OrganizationSwitcher({ organizations, activeId }: { organizations: OrganizationContext[]; activeId: string }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const active = organizations.find((org) => org.id === activeId);
  if (organizations.length < 2) return <div className="flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm"><Building2 size={16} className="text-rack"/><span className="font-medium">{active?.name}</span></div>;
  return <label className="relative flex items-center gap-2 rounded-md border border-line bg-paper px-3 py-2 text-sm"><Building2 size={16} className="text-rack"/><select value={activeId} disabled={busy} onChange={async event => { setBusy(true); await fetch("/api/org-context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ orgId: event.target.value }) }); router.refresh(); setBusy(false); }} className="appearance-none bg-transparent pr-5 font-medium outline-none"><option value={activeId}>{active?.name}</option>{organizations.filter(org => org.id !== activeId).map(org => <option key={org.id} value={org.id}>{org.name}</option>)}</select><ChevronDown size={14} className="pointer-events-none absolute right-2 text-graphite"/></label>;
}
