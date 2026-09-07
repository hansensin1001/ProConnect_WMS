import { PageHeader } from "@/components/PageHeader";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default async function ReportsPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();
  const [{ data: stock }, { data: orders }, { data: scans }] = await Promise.all([
    supabase.from("inventory_balances").select("quantity_on_hand, quantity_reserved, products(sku, name)").limit(100),
    supabase.from("sales_orders").select("status").eq("org_id", ctx.org.id),
    supabase.from("scan_events").select("event_type, quantity").eq("org_id", ctx.org.id),
  ]);
  const stockLines = (stock ?? []) as any[];
  const orderRows = (orders ?? []) as any[];
  const scanRows = (scans ?? []) as any[];
  const totalOnHand = stockLines.reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0);
  const totalReserved = stockLines.reduce((sum, row) => sum + Number(row.quantity_reserved || 0), 0);
  const openOrders = orderRows.filter((row) => ["NEW", "ALLOCATED", "PICKING"].includes(row.status)).length;
  const pickedUnits = scanRows.filter((row) => row.event_type === "PICK").reduce((sum, row) => sum + Number(row.quantity || 0), 0);

  return <div>
    <PageHeader title="Reports" subtitle="Live warehouse operations summary" />
    <div className="p-8 space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {[['Units on hand', totalOnHand], ['Units reserved', totalReserved], ['Open orders', openOrders], ['Units picked', pickedUnits]].map(([label, value]) => (
          <div key={String(label)} className="border border-line border-l-4 border-l-rack bg-panel px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-graphite">{label}</div>
            <div className="stencil mt-1 text-4xl">{value}</div>
          </div>
        ))}
      </div>
      <div className="border border-line bg-panel">
        <div className="border-b border-line px-5 py-3 text-sm font-medium">Inventory by SKU</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-graphite"><th className="px-5 py-3">SKU</th><th className="px-5 py-3">Product</th><th className="px-5 py-3 text-right">On hand</th><th className="px-5 py-3 text-right">Reserved</th></tr></thead>
          <tbody>{stockLines.map((row, index) => <tr key={index} className="border-t border-line"><td className="code-label px-5 py-3">{row.products?.sku ?? '—'}</td><td className="px-5 py-3">{row.products?.name ?? 'Unknown product'}</td><td className="px-5 py-3 text-right">{row.quantity_on_hand}</td><td className="px-5 py-3 text-right">{row.quantity_reserved}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  </div>;
}
