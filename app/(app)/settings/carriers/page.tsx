import { CarrierManager } from "@/components/CarrierManager";
import { PageHeader } from "@/components/PageHeader";
import { getCurrentOrgContext } from "@/lib/org";

export default async function CarriersPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const canManage = ctx.role === "owner" || ctx.role === "manager";
  return <div><PageHeader title="Manage Carriers" subtitle={`Shipping integrations for ${ctx.org.code ?? "ORG"} · ${ctx.org.name}`} /><div className="p-8">{canManage ? <CarrierManager orgId={ctx.org.id} orgName={ctx.org.name} /> : <div className="rounded-lg border border-line bg-panel p-6 text-sm text-graphite">Manager or owner access is required to configure carrier integrations.</div>}</div></div>;
}
