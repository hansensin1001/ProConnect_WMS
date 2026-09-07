import { PageHeader } from "@/components/PageHeader";
import { PurchaseOrderManager } from "@/components/PurchaseOrderManager";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default async function PurchaseOrdersPage() {
  const ctx = await getCurrentOrgContext(); if (!ctx?.org) return null;
  const supabase = createClient();
  const [{ data: orders }, { data: products }, { data: locations }] = await Promise.all([
    supabase.from("purchase_orders").select("id, po_number, supplier_name, status, created_at, purchase_order_items(id, product_id, location_id, quantity_expected, quantity_received)").eq("org_id", ctx.org.id).order("created_at", { ascending: false }),
    supabase.from("products").select("id, sku, name").eq("org_id", ctx.org.id).order("sku"),
    supabase.from("locations").select("id, location_code, warehouse_zones(warehouse_id, warehouses(code, name))"),
  ]);
  return <div><PageHeader title="Purchase Orders" subtitle={`Inbound stock for ${ctx.org.name}`} /><div className="p-8"><PurchaseOrderManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} initialOrders={(orders ?? []) as any[]} products={(products ?? []) as any[]} locations={(locations ?? []) as any[]} /></div></div>;
}
