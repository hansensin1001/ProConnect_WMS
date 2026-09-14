import { DashboardOverview } from "@/components/DashboardOverview";
import { PageHeader } from "@/components/PageHeader";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";

async function getDashboardData(orgId: string) {
  const supabase = createClient();
  const [
    { count: skuCount, error: skuError },
    { count: serializedSkuCount, error: serializedError },
    { count: openSalesOrders, error: openSalesError },
    { count: allocatedOrders, error: allocatedError },
    { count: openPurchaseOrders, error: openPurchaseError },
    { count: lowStockBalances, error: lowStockError },
    { count: quarantinedBalances, error: quarantineError },
    { data: salesOrders, error: salesFeedError },
    { data: purchaseOrders, error: purchaseFeedError },
  ] = await Promise.all([
    supabase.from("products").select("id", { count: "exact", head: true }).eq("org_id", orgId),
    supabase.from("products").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("is_serialized", true),
    supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["NEW", "ALLOCATED", "PICKING", "PARTIALLY_SHIPPED"]),
    supabase.from("sales_orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).eq("status", "ALLOCATED"),
    supabase.from("purchase_orders").select("id", { count: "exact", head: true }).eq("org_id", orgId).in("status", ["PENDING", "PARTIALLY_RECEIVED"]),
    (supabase.from("inventory_balances") as any).select("id, products!inner(org_id)", { count: "exact", head: true }).eq("products.org_id", orgId).lt("quantity_on_hand", 5),
    (supabase.from("inventory_balances") as any).select("id, products!inner(org_id)", { count: "exact", head: true }).eq("products.org_id", orgId).gt("quantity_quarantined", 0),
    supabase.from("sales_orders").select("id, order_number, customer_name, status, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(6),
    supabase.from("purchase_orders").select("id, po_number, supplier_name, status, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(6),
  ]);

  const activity = [
    ...(salesOrders ?? []).map((order: any) => ({ id: order.id, kind: "SALES" as const, reference: order.order_number, counterparty: order.customer_name, status: order.status, createdAt: order.created_at, href: "/orders" })),
    ...(purchaseOrders ?? []).map((order: any) => ({ id: order.id, kind: "PURCHASE" as const, reference: order.po_number, counterparty: order.supplier_name, status: order.status, createdAt: order.created_at, href: "/purchase-orders" })),
  ].sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()).slice(0, 8);

  return {
    metrics: {
      skuCount: skuCount ?? 0,
      serializedSkuCount: serializedSkuCount ?? 0,
      openSalesOrders: openSalesOrders ?? 0,
      allocatedOrders: allocatedOrders ?? 0,
      openPurchaseOrders: openPurchaseOrders ?? 0,
      lowStockBalances: lowStockBalances ?? 0,
      quarantinedBalances: quarantinedBalances ?? 0,
    },
    activity,
    error: [skuError, serializedError, openSalesError, allocatedError, openPurchaseError, lowStockError, quarantineError, salesFeedError, purchaseFeedError].find(Boolean),
  };
}

export default async function DashboardPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const { metrics, activity, error } = await getDashboardData(ctx.org.id);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle={`Warehouse operations for ${ctx.org.code ?? "ORG"} · ${ctx.org.name}`} />
      <div className="p-5 sm:p-8">
        {error && <div className="mb-6 rounded-lg border border-alert/30 bg-alert/5 px-4 py-3 text-sm text-alert">Some dashboard indicators could not be loaded. Review the database schema and organization permissions, then refresh this page.</div>}
        <DashboardOverview organizationName={ctx.org.name} generatedAt={new Date().toISOString()} metrics={metrics} activity={activity} />
      </div>
    </div>
  );
}
