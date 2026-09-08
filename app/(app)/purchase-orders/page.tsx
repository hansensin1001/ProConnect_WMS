import { PageHeader } from "@/components/PageHeader";
import { PurchaseOrderManager } from "@/components/PurchaseOrderManager";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

const PAGE_SIZE = 50;
export default async function PurchaseOrdersPage({ searchParams }: { searchParams?: { page?: string } }) {
  const ctx = await getCurrentOrgContext(); if (!ctx?.org) return null;
  const supabase = createClient();
  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const [{ data: orders, count }, { data: products }, { data: warehouses }] = await Promise.all([
    supabase.from("purchase_orders").select("id, po_number, supplier_name, status, created_at, purchase_order_items(id, product_id, location_id, quantity_expected, quantity_received)", { count: "exact" }).eq("org_id", ctx.org.id).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase.from("products").select("id, sku, name, is_serialized").eq("org_id", ctx.org.id).order("sku").limit(200),
    supabase.from("warehouses").select("id").eq("org_id", ctx.org.id),
  ]);
  const warehouseIds = (warehouses ?? []).map((warehouse: { id: string }) => warehouse.id);
  // A purchase-order drawer needs a compact starter list, not every bin in a
  // tenant. The remaining locations are available through the paginated
  // location-options endpoint when a user searches for a bin.
  const { data: locations } = warehouseIds.length
    ? await supabase.from("locations").select("id, display_code, location_code, warehouse_zones!inner(warehouse_id)").in("warehouse_zones.warehouse_id", warehouseIds).eq("is_active", true).order("location_code").limit(200)
    : { data: [] };
  return <div><PageHeader title="Purchase Orders" subtitle={`Inbound stock for ${ctx.org.name}`} /><div className="p-8"><PurchaseOrderManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} initialOrders={(orders ?? []) as any[]} products={(products ?? []) as any[]} locations={(locations ?? []) as any[]} page={page} total={count ?? 0} /></div></div>;
}
