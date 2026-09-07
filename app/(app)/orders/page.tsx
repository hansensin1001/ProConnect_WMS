import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { OrderManager } from "@/components/OrderManager";

const STATUS_STYLES: Record<string, string> = {
  NEW: "bg-graphite/10 text-graphite border-graphite/30",
  ALLOCATED: "bg-rack/10 text-rack border-rack/30",
  PICKING: "bg-amber/10 text-amber-dark border-amber/40",
  PACKED: "bg-amber/10 text-amber-dark border-amber/40",
  SHIPPED: "bg-go/10 text-go border-go/30",
};

export default async function OrdersPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const { data } = await supabase
    .from("sales_orders")
    .select("id, order_number, platform, customer_name, status, created_at")
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false });

  const orders = (data ?? []) as {
    id: string;
    order_number: string;
    platform: string;
    customer_name: string | null;
    status: string;
    created_at: string;
  }[];

  return (
    <div>
      <PageHeader title="Orders" subtitle={`Sales orders for ${ctx.org.name} · ${ctx.org.slug}`} />

      <div className="p-8">
        <OrderManager orgId={ctx.org.id} orgName={ctx.org.name} canManage={ctx.role === "owner" || ctx.role === "manager"} initialOrders={orders} />
      </div>
    </div>
  );
}
