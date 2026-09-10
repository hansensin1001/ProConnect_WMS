import { RtvReturnConsoleV3 } from "@/components/RtvReturnConsoleV3";
import { PageHeader } from "@/components/PageHeader";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

export default async function RtvReturnsPage() {
  const context = await getCurrentOrgContext();
  if (!context?.org) return null;
  const supabase = createClient();
  const { data } = await supabase
    .from("purchase_orders")
    .select("id,po_number,supplier_name,status,purchase_order_items(id,product_id,location_id,quantity_received,products(sku,name,is_serialized),locations(location_code,display_code))")
    .eq("org_id", context.org.id)
    .in("status", ["RECEIVED", "PARTIALLY_RECEIVED", "COMPLETED"])
    .order("created_at", { ascending: false })
    .limit(200);
  const purchaseOrders = (data ?? []).filter((order: any) => (order.purchase_order_items ?? []).some((line: any) => line.quantity_received > 0));
  return (
    <div>
      <PageHeader title="Vendor Returns (RTV)" subtitle="Return accepted PO stock from its original putaway bin with full traceability" />
      <div className="p-8"><RtvReturnConsoleV3 orgId={context.org.id} purchaseOrders={purchaseOrders as any} /></div>
    </div>
  );
}
