import { WorkflowNotice } from "@/components/ui/WorkflowNotice";
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
      .select("id,order_number,customer_name,order_items(product_id,quantity_picked,products(sku,name,is_serialized))")
      .eq("org_id", context.org.id)
      .eq("status", "SHIPPED")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("locations")
      .select("id,location_code,display_code,warehouse_zones!inner(zone_type,zone_code,warehouses!inner(org_id,name))")
      .eq("warehouse_zones.warehouses.org_id", context.org.id)
      .in("warehouse_zones.zone_type", ["STORAGE", "QUARANTINE"])
      .eq("is_active", true)
      .order("location_code").limit(300),
  ]);
  return (
    <div>
      <PageHeader title="Customer Returns (RMA)" subtitle="Receive verified shipped-order returns into putaway or quarantine" />
      <div className="p-8">
        {(orders.error || bins.error) ? <WorkflowNotice notice={{ kind: "error", text: "Return documents or bins could not be loaded. Refresh before receiving stock." }} /> : <RmaReturnConsoleV3 orgId={context.org.id} salesOrders={(orders.data ?? []) as any} bins={(bins.data ?? []) as any} />}
      </div>
    </div>
  );
}
