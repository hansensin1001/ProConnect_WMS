"use client";

import { FormEvent, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Role = "owner" | "manager" | "operator";
type Member = { id: string; user_id: string; role: Role; created_at: string };

const ROLE_COPY: Record<Role, string> = {
  owner: "Full organization, user and configuration control.",
  manager: "Operational management access; cannot manage owners.",
  operator: "Day-to-day inventory, order and scan access.",
};

export function UserManager({ orgId, currentUserId, initialMembers }: { orgId: string; currentUserId: string; initialMembers: Member[] }) {
  const supabase = createClient();
  const [members, setMembers] = useState(initialMembers);
  const [userId, setUserId] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!userId.trim()) return;
    setBusy(true); setMessage(null);
    const { data, error } = await (supabase.from("org_members") as any).insert({ org_id: orgId, user_id: userId.trim(), role }).select("id, user_id, role, created_at").single();
    setBusy(false);
    if (error) return setMessage(error.message);
    setMembers((current) => [...current, data as Member]);
    setUserId(""); setMessage("User added.");
  }

  async function changeRole(member: Member, nextRole: Role) {
    setMessage(null);
    const { error } = await (supabase.from("org_members") as any).update({ role: nextRole }).eq("id", member.id);
    if (error) return setMessage(error.message);
    setMembers((current) => current.map((item) => item.id === member.id ? { ...item, role: nextRole } : item));
  }

  async function removeMember(member: Member) {
    if (member.user_id === currentUserId) return;
    setMessage(null);
    const { error } = await supabase.from("org_members").delete().eq("id", member.id);
    if (error) return setMessage(error.message);
    setMembers((current) => current.filter((item) => item.id !== member.id));
  }

  return <div className="max-w-3xl space-y-6">
    <section className="border border-line bg-panel p-5">
      <h2 className="stencil text-xl">Add existing user</h2>
      <p className="mt-1 text-sm text-graphite">Create the user in Supabase Authentication first, then paste their User UUID here.</p>
      <form onSubmit={addMember} className="mt-4 flex flex-col gap-3 sm:flex-row">
        <input value={userId} onChange={(event) => setUserId(event.target.value)} placeholder="Supabase user UUID" className="flex-1 border border-line bg-paper px-3 py-2 text-sm code-label" required />
        <select value={role} onChange={(event) => setRole(event.target.value as Role)} className="border border-line bg-paper px-3 py-2 text-sm">
          <option value="operator">Operator</option><option value="manager">Manager</option><option value="owner">Owner</option>
        </select>
        <button disabled={busy} className="bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-60">{busy ? "Adding…" : "Add user"}</button>
      </form>
      {message && <p className="mt-3 text-sm text-graphite">{message}</p>}
    </section>
    <section className="border border-line bg-panel">
      <div className="border-b border-line px-5 py-3 text-sm font-medium">Organization members</div>
      <div className="divide-y divide-line">{members.map((member) => <div key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="min-w-[16rem] flex-1"><div className="code-label text-xs">{member.user_id}</div><div className="mt-1 text-xs text-graphite">{ROLE_COPY[member.role]}</div></div>
        <select value={member.role} onChange={(event) => changeRole(member, event.target.value as Role)} className="border border-line bg-paper px-2 py-1 text-sm" aria-label={`Role for ${member.user_id}`}>
          <option value="operator">Operator</option><option value="manager">Manager</option><option value="owner">Owner</option>
        </select>
        <button onClick={() => removeMember(member)} disabled={member.user_id === currentUserId} className="border border-alert/40 px-3 py-1 text-sm text-alert disabled:cursor-not-allowed disabled:opacity-40">Remove</button>
      </div>)}</div>
    </section>
  </div>;
}
