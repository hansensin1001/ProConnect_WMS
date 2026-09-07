import { createClient } from "@/lib/supabase/server";
import { cookies } from "next/headers";

export type OrganizationContext = { id: string; name: string; slug: string; code?: string | null; deployment_mode: string };

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
    .order("created_at");

  const memberships = (data ?? []) as unknown as {
    org_id: string;
    role: string;
    organizations: { id: string; name: string; slug: string; deployment_mode: string };
  }[];

  if (!memberships.length) return { user, org: null, role: null, organizations: [] as OrganizationContext[] };

  const requestedOrgId = cookies().get("proconnect-org-id")?.value;
  const membership = memberships.find((item) => item.org_id === requestedOrgId) ?? memberships[0];
  const organizations = memberships.map((item) => item.organizations).filter(Boolean) as OrganizationContext[];

  return {
    user,
    org: membership.organizations,
    role: membership.role,
    organizations,
  };
}
