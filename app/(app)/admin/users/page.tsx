import { PageHeader } from "@/components/PageHeader";
import { PlatformAdmin } from "@/components/PlatformAdmin";
import { getCurrentOrgContext } from "@/lib/org";

export default async function UsersPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;

  if (ctx.role !== "owner") {
    return <div><PageHeader title="Administration" subtitle="Owner access required" /><div className="p-8 text-sm text-graphite">Only organization owners can manage user roles.</div></div>;
  }

  return <div>
    <PageHeader title="Platform administration" subtitle="Organizations, users, roles and access rights" />
    <div className="p-8">
      <PlatformAdmin />
    </div>
  </div>;
}
