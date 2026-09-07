"use client";

import { FormEvent, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Org = { id: string; name: string; slug: string; deployment_mode: string; org_members: { id: string; role: string; email?: string; disabled?: boolean }[] };

export function PlatformAdmin() {
  const supabase = createClient();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [notice, setNotice] = useState("Loading organizations…");
  const [busy, setBusy] = useState(false);

  async function api(path = "", init: RequestInit = {}) {
    const { data } = await supabase.auth.getSession();
    const response = await fetch(`/api/admin${path}`, { ...init, headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session?.access_token ?? ""}`, ...(init.headers ?? {}) } });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Request failed.");
    return result;
  }
  async function load() { try { const result = await api(); setOrgs(result.organizations); setNotice(""); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to load organizations."); } }
  useEffect(() => { load(); }, []);
  async function createOrg(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await api("", { method: "POST", body: JSON.stringify({ kind: "organization", name: form.get("name"), slug: form.get("slug"), deploymentMode: form.get("mode") }) }); event.currentTarget.reset(); await load(); setNotice("Organization created."); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to create organization."); } finally { setBusy(false); } }
  async function createUser(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); try { await api("", { method: "POST", body: JSON.stringify({ kind: "user", email: form.get("email"), password: form.get("password"), orgId: form.get("orgId"), role: form.get("role") }) }); event.currentTarget.reset(); await load(); setNotice("User created and assigned."); } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to create user."); } finally { setBusy(false); } }

  return <div className="max-w-4xl space-y-6">
    {notice && <div className="border border-amber/40 bg-amber/10 px-4 py-3 text-sm">{notice}</div>}
    <section className="border border-line bg-panel p-5"><h2 className="stencil text-xl">Create organization</h2><form onSubmit={createOrg} className="mt-4 grid gap-3 sm:grid-cols-3"><input name="name" required placeholder="Organization name" className="border border-line bg-paper px-3 py-2 text-sm" /><input name="slug" required placeholder="organization-slug" className="border border-line bg-paper px-3 py-2 text-sm code-label" /><select name="mode" className="border border-line bg-paper px-3 py-2 text-sm"><option value="managed">Managed SaaS</option><option value="client_managed">Client-managed</option></select><button disabled={busy} className="bg-ink px-4 py-2 text-sm font-medium text-white sm:col-span-3">Create organization</button></form></section>
    <section className="border border-line bg-panel p-5"><h2 className="stencil text-xl">Create user and assign access</h2><p className="mt-1 text-sm text-graphite">Creates the login account and assigns its organization and role.</p><form onSubmit={createUser} className="mt-4 grid gap-3 sm:grid-cols-2"><input name="email" type="email" required placeholder="user@company.com" className="border border-line bg-paper px-3 py-2 text-sm" /><input name="password" type="password" minLength={8} required placeholder="Temporary password (8+ characters)" className="border border-line bg-paper px-3 py-2 text-sm" /><select name="orgId" required className="border border-line bg-paper px-3 py-2 text-sm"><option value="">Assign organization…</option>{orgs.map((org) => <option key={org.id} value={org.id}>{org.name}</option>)}</select><select name="role" className="border border-line bg-paper px-3 py-2 text-sm"><option value="operator">Operator</option><option value="manager">Manager</option><option value="owner">Owner</option></select><button disabled={busy || orgs.length === 0} className="bg-ink px-4 py-2 text-sm font-medium text-white sm:col-span-2">Create and assign user</button></form></section>
    <section className="overflow-hidden border border-line bg-panel"><div className="border-b border-line px-5 py-3 text-sm font-medium">Organizations and assigned users</div><div className="overflow-x-auto"><table className="w-full min-w-[680px] text-sm"><thead className="bg-paper text-left text-[11px] uppercase tracking-wide text-graphite"><tr><th className="px-5 py-3">Name / email</th><th className="px-5 py-3">Organization</th><th className="px-5 py-3">Role</th><th className="px-5 py-3">Status</th><th className="px-5 py-3">Actions</th></tr></thead><tbody>{orgs.flatMap(org=>org.org_members.map(member=><tr key={member.id} className="border-t border-line hover:bg-paper/70"><td className="px-5 py-3"><div className="font-medium">{member.email?.split("@")[0] ?? "User"}</div><div className="text-graphite">{member.email}</div></td><td className="px-5 py-3">{org.name}</td><td className="px-5 py-3"><span className="rounded-full bg-rack/10 px-2.5 py-1 text-xs font-medium text-rack">{member.role}</span></td><td className="px-5 py-3"><span className={`rounded-full px-2.5 py-1 text-xs font-medium ${member.disabled?"bg-slate-100 text-graphite":"bg-emerald-50 text-go"}`}>{member.disabled?"Inactive":"Active"}</span></td><td className="px-5 py-3 text-graphite">•••</td></tr>))}</tbody></table></div></section>
  </div>;
}
