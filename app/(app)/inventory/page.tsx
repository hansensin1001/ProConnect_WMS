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
    .select("id, sku, barcode, name, description, price, unit_of_measure, is_serialized", { count: "exact" })
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
    is_serialized: boolean;
  }[];

  const productIds = products.map((product) => product.id);
  // Aggregate in Postgres so the route sends at most one stock-total record
  // per displayed product instead of all balances, bins and lots.
  const { data: totals, error: totalsError } = productIds.length
    ? await (supabase.rpc as any)("get_inventory_page_totals", { p_product_ids: productIds })
    : { data: [], error: null };
  if (totalsError) throw totalsError;
  const totalsByProduct = new Map<string, { onHand: number; reserved: number; locations: number }>();
  (totals ?? []).forEach((total: any) => {
    totalsByProduct.set(total.product_id, {
      onHand: Number(total.quantity_on_hand),
      reserved: Number(total.quantity_reserved),
      locations: Number(total.location_count),
    });
  });

  return (
    <div>
      <PageHeader title="Inventory" subtitle="Stock on hand across all locations" />

      <div className="p-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><InventorySearch initialQuery={query} /><ProductManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} /></div>
        <InventoryTable orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} rows={products.map((product) => ({ ...product, ...(totalsByProduct.get(product.id) ?? { onHand: 0, reserved: 0, locations: 0 }) }))} page={page} total={count ?? 0} />
      </div>
    </div>
  );
}
