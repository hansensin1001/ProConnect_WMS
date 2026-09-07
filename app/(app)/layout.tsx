import { redirect } from "next/navigation";
import { getCurrentOrgContext } from "@/lib/org";
import { Sidebar } from "@/components/Sidebar";

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

  return (
    <div className="flex">
      <Sidebar orgName={ctx.org.name} />
      <main className="flex-1 min-h-screen">{children}</main>
    </div>
  );
}
