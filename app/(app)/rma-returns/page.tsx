import { RmaReturnConsoleV3 } from "@/components/RmaReturnConsoleV3";
import { PageHeader } from "@/components/PageHeader";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default async function RmaReturnsPage() {
  const context = await getCurrentOrgContext();
  if (!context?.org) return null;
  const supabase = createClient();
  const [orders, bins] = await Promise.all([
    supabase
      .from("sales_orders")
      .select("id,order_number,customer_name,order_items(product_id,products(sku,name,is_serialized))")
      .eq("org_id", context.org.id)
      .eq("status", "SHIPPED")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("locations")
      .select("id,location_code,display_code,warehouse_zones!inner(zone_type,warehouses!inner(org_id))")
      .eq("warehouse_zones.warehouses.org_id", context.org.id)
      .in("warehouse_zones.zone_type", ["STORAGE", "QUARANTINE"])
      .eq("is_active", true)
      .limit(300),
  ]);
  return (
    <div>
      <PageHeader title="Customer Returns (RMA)" subtitle="Receive verified shipped-order returns into putaway or quarantine" />
      <div className="p-8">
        <RmaReturnConsoleV3 orgId={context.org.id} salesOrders={(orders.data ?? []) as any} bins={(bins.data ?? []) as any} />
      </div>
    </div>
  );
}
