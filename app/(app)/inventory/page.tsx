import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { ProductManager } from "@/components/ProductManager";
import { InventoryTable } from "@/components/InventoryTable";

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
    .select("product_id, quantity_on_hand, quantity_reserved, locations(location_code), products!inner(org_id)")
    .eq("products.org_id", ctx.org.id);

  const { data: warehouses } = await supabase.from("warehouses").select("id").eq("org_id", ctx.org.id);
  const warehouseIds = (warehouses ?? []).map((warehouse: { id: string }) => warehouse.id);
  const { data: locations } = warehouseIds.length
    ? await supabase.from("locations").select("id, display_code, location_code, warehouse_zones!inner(warehouse_id)").in("warehouse_zones.warehouse_id", warehouseIds).eq("is_active", true)
    : { data: [] };

  const totalsByProduct = new Map<string, { onHand: number; reserved: number; locations: number; stockByLocation: { locationCode: string; onHand: number; reserved: number }[] }>();
  (balances ?? []).forEach((b: any) => {
    const cur = totalsByProduct.get(b.product_id) ?? { onHand: 0, reserved: 0, locations: 0, stockByLocation: [] };
    cur.onHand += b.quantity_on_hand;
    cur.reserved += b.quantity_reserved;
    cur.locations += 1;
    cur.stockByLocation.push({ locationCode: b.locations?.location_code ?? "Unknown bin", onHand: b.quantity_on_hand, reserved: b.quantity_reserved });
    totalsByProduct.set(b.product_id, cur);
  });

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock on hand across all locations" />

      <div className="p-8">
        <ProductManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} />
        <InventoryTable orgId={ctx.org.id} locations={(locations ?? []) as any[]} canManage={ctx.role === "owner" || ctx.role === "manager"} rows={products.map((product) => ({ ...product, ...(totalsByProduct.get(product.id) ?? { onHand: 0, reserved: 0, locations: 0, stockByLocation: [] }) }))} />
      </div>
    </div>
  );
}
