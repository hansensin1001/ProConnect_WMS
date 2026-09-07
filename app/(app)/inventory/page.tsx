import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { ProductManager } from "@/components/ProductManager";

export default async function InventoryPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const { data } = await supabase
    .from("products")
    .select("id, sku, barcode, name, unit_of_measure")
    .eq("org_id", ctx.org.id)
    .order("sku");

  const products = (data ?? []) as {
    id: string;
    sku: string;
    barcode: string;
    name: string;
    unit_of_measure: string;
  }[];

  const { data: balances } = await supabase
    .from("inventory_balances")
    .select("product_id, quantity_on_hand, quantity_reserved, locations(location_code)");

  const totalsByProduct = new Map<string, { onHand: number; reserved: number; locations: number }>();
  (balances ?? []).forEach((b: any) => {
    const cur = totalsByProduct.get(b.product_id) ?? { onHand: 0, reserved: 0, locations: 0 };
    cur.onHand += b.quantity_on_hand;
    cur.reserved += b.quantity_reserved;
    cur.locations += 1;
    totalsByProduct.set(b.product_id, cur);
  });

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock on hand across all locations" />

      <div className="p-8">
        <ProductManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} />
        <div className="bg-panel border border-line mt-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-graphite">
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Barcode</th>
                <th className="px-5 py-3 font-medium text-right">On hand</th>
                <th className="px-5 py-3 font-medium text-right">Reserved</th>
                <th className="px-5 py-3 font-medium text-right">Locations</th>
              </tr>
            </thead>
            <tbody>
              {products.map((p) => {
                const t = totalsByProduct.get(p.id) ?? { onHand: 0, reserved: 0, locations: 0 };
                const low = t.onHand < 5;
                return (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 code-label">{p.sku}</td>
                    <td className="px-5 py-3">{p.name}</td>
                    <td className="px-5 py-3 code-label text-graphite">{p.barcode}</td>
                    <td className={`px-5 py-3 text-right font-medium ${low ? "text-alert" : ""}`}>
                      {t.onHand} {p.unit_of_measure}
                    </td>
                    <td className="px-5 py-3 text-right text-graphite">{t.reserved}</td>
                    <td className="px-5 py-3 text-right text-graphite">{t.locations}</td>
                  </tr>
                );
              })}
              {products.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-graphite">
                    No products yet. Add rows to the{" "}
                    <span className="code-label">products</span> table to get started.
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
