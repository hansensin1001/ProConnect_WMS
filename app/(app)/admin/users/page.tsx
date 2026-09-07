import { PageHeader } from "@/components/PageHeader";
import { UserManager } from "@/components/UserManager";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default async function UsersPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;

  if (ctx.role !== "owner") {
    return <div><PageHeader title="Administration" subtitle="Owner access required" /><div className="p-8 text-sm text-graphite">Only organization owners can manage user roles.</div></div>;
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("org_members")
    .select("id, user_id, role, created_at")
    .eq("org_id", ctx.org.id)
    .order("created_at");

  return <div>
    <PageHeader title="Administration" subtitle="Users, roles and access rights" />
    <div className="p-8">
      <UserManager orgId={ctx.org.id} currentUserId={ctx.user.id} initialMembers={(data ?? []) as any[]} />
    </div>
  </div>;
}
