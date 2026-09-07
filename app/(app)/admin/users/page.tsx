import { PageHeader } from "@/components/PageHeader";
import { PlatformAdmin } from "@/components/PlatformAdmin";
import { getCurrentOrgContext } from "@/lib/org";
import { isPlatformAdmin } from "@/lib/platform-admin";

export default async function UsersPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;

  if (!(await isPlatformAdmin(ctx.user.id))) {
    return <div><PageHeader title="Administration" subtitle="Administrator access required" /><div className="p-8 text-sm text-graphite">Only platform administrators can manage users, organizations, and access rights.</div></div>;
  }

  return <div>
    <PageHeader title="Platform administration" subtitle="Organizations, users, roles and access rights" />
    <div className="p-8">
      <PlatformAdmin />
    </div>
  </div>;
}
