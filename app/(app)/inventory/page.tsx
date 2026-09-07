import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { ProductManager } from "@/components/ProductManager";
import { InventoryTable } from "@/components/InventoryTable";
import { InventorySearch } from "@/components/InventorySearch";

const PAGE_SIZE = 50;
export default async function InventoryPage({ searchParams }: { searchParams?: { page?: string; q?: string } }) {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const query = (searchParams?.q ?? "").trim().slice(0, 80).replace(/[,%()]/g, "");
  const from = (page - 1) * PAGE_SIZE;
  let productQuery = supabase
    .from("products")
    .select("id, sku, barcode, name, description, price, unit_of_measure", { count: "exact" })
    .eq("org_id", ctx.org.id)
    .order("sku");
  if (query) productQuery = productQuery.or(`sku.ilike.%${query}%,name.ilike.%${query}%`);
  const { data, count } = await productQuery.range(from, from + PAGE_SIZE - 1);

  const products = (data ?? []) as {
    id: string;
    sku: string;
    barcode: string;
    name: string;
    description: string | null;
    price: number;
    unit_of_measure: string;
  }[];

  const productIds = products.map((product) => product.id);
  const { data: balances } = productIds.length
    ? await supabase.from("inventory_balances").select("product_id, quantity_on_hand, quantity_reserved, locations(location_code)").in("product_id", productIds)
    : { data: [] };

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
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><InventorySearch initialQuery={query} /><ProductManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} /></div>
        <InventoryTable orgId={ctx.org.id} locations={(locations ?? []) as any[]} canManage={ctx.role === "owner" || ctx.role === "manager"} rows={products.map((product) => ({ ...product, ...(totalsByProduct.get(product.id) ?? { onHand: 0, reserved: 0, locations: 0, stockByLocation: [] }) }))} page={page} total={count ?? 0} />
      </div>
    </div>
  );
}
