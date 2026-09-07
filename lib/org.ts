import { createClient } from "@/lib/supabase/server";

export async function getCurrentOrgContext() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data } = await supabase
    .from("org_members")
    .select("org_id, role, organizations(id, name, slug, deployment_mode)")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const membership = data as unknown as {
    org_id: string;
    role: string;
    organizations: { id: string; name: string; slug: string; deployment_mode: string };
  } | null;

  if (!membership) return { user, org: null, role: null };

  return {
    user,
    org: membership.organizations,
    role: membership.role,
  };
}
