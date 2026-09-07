import { redirect } from "next/navigation";
import { getCurrentOrgContext } from "@/lib/org";
import { Sidebar } from "@/components/Sidebar";
import { OrganizationSwitcher } from "@/components/OrganizationSwitcher";
import { AuthProvider } from "@/components/AuthProvider";
import { isPlatformAdmin } from "@/lib/platform-admin";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ctx = await getCurrentOrgContext();

  if (!ctx) {
    redirect("/login");
  }

  if (!ctx.org) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="max-w-md text-center">
          <h1 className="stencil text-2xl mb-3">No organization yet</h1>
          <p className="text-sm text-graphite">
            Your account isn&apos;t linked to a ProConnect organization. Ask your
            administrator to add you via <code className="code-label">org_members</code>{" "}
            in Supabase, then refresh.
          </p>
        </div>
      </div>
    );
  }

  const platformAdmin = await isPlatformAdmin(ctx.user.id);

  return (
    <AuthProvider><div className="flex">
      <Sidebar orgName={`${ctx.org.code ?? "ORG"} · ${ctx.org.name}`} isPlatformAdmin={platformAdmin} />
      <main className="flex-1 min-h-screen"><div className="flex justify-end border-b border-line bg-panel px-5 py-3"><OrganizationSwitcher organizations={ctx.organizations} activeId={ctx.org.id} /></div>{children}</main>
    </div></AuthProvider>
  );
}
