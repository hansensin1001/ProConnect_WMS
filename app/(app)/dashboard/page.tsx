import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";

async function getCounts(orgId: string) {
  const supabase = createClient();

  const [{ count: productCount }, { count: openOrders }, { count: lowStockish }, { data: recentScans }] =
    await Promise.all([
      supabase.from("products").select("*", { count: "exact", head: true }).eq("org_id", orgId),
      supabase
        .from("sales_orders")
        .select("*", { count: "exact", head: true })
        .eq("org_id", orgId)
        .in("status", ["NEW", "ALLOCATED", "PICKING"]),
      supabase
        .from("inventory_balances")
        .select("*", { count: "exact", head: true })
        .lt("quantity_on_hand", 5),
      supabase
        .from("scan_events")
        .select("event_type, quantity, created_at")
        .eq("org_id", orgId)
        .order("created_at", { ascending: false })
        .limit(6),
    ]);

  return {
    productCount: productCount ?? 0,
    openOrders: openOrders ?? 0,
    lowStockish: lowStockish ?? 0,
    recentScans: (recentScans ?? []) as {
      event_type: string;
      quantity: number;
      created_at: string;
    }[],
  };
}

export default async function DashboardPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;

  const { productCount, openOrders, lowStockish, recentScans } = await getCounts(ctx.org.id);

  const cards = [
    { label: "SKUs tracked", value: productCount, accent: "border-l-rack" },
    { label: "Open orders", value: openOrders, accent: "border-l-amber" },
    { label: "Low-stock lines", value: lowStockish, accent: "border-l-alert" },
  ];

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Operations overview — ${ctx.org.name}`}
      />

      <div className="p-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {cards.map((c) => (
            <div
              key={c.label}
              className={`bg-panel border border-line border-l-4 ${c.accent} px-5 py-4`}
            >
              <div className="text-xs uppercase tracking-wide text-graphite mb-1">
                {c.label}
              </div>
              <div className="stencil text-4xl text-ink">{c.value}</div>
            </div>
          ))}
        </div>

        <div className="bg-panel border border-line">
          <div className="px-5 py-3 border-b border-line text-sm font-medium">
            Recent scan activity
          </div>
          {recentScans.length === 0 ? (
            <div className="px-5 py-8 text-sm text-graphite">
              No scans logged yet. Put-away and pick actions from the Scan
              screen will show up here.
            </div>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {recentScans.map((s, i) => (
                  <tr key={i} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 code-label text-xs text-graphite w-40">
                      {new Date(s.created_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={
                          s.event_type === "PICK"
                            ? "text-alert font-medium"
                            : "text-go font-medium"
                        }
                      >
                        {s.event_type}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-graphite">qty {s.quantity}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
