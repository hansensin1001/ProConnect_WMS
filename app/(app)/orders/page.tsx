import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";

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
      <PageHeader title="Orders" subtitle="Sales orders across all connected channels" />

      <div className="p-8">
        <div className="bg-panel border border-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-graphite">
                <th className="px-5 py-3 font-medium">Order #</th>
                <th className="px-5 py-3 font-medium">Channel</th>
                <th className="px-5 py-3 font-medium">Customer</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-line last:border-0">
                  <td className="px-5 py-3 code-label">{o.order_number}</td>
                  <td className="px-5 py-3 text-graphite">{o.platform}</td>
                  <td className="px-5 py-3">{o.customer_name ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`text-xs px-2 py-1 border ${
                        STATUS_STYLES[o.status] ?? STATUS_STYLES.NEW
                      }`}
                    >
                      {o.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-graphite text-xs">
                    {new Date(o.created_at).toLocaleDateString()}
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-10 text-center text-graphite">
                    No orders yet. Connect a channel or add rows to{" "}
                    <span className="code-label">sales_orders</span>.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
