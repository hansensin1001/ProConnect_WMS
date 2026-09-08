import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { OrderManager } from "@/components/OrderManager";

const PAGE_SIZE = 50;
export default async function OrdersPage({ searchParams }: { searchParams?: { page?: string } }) {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const { data, count } = await supabase
    .from("sales_orders")
    .select("id, order_number, platform, customer_name, shipping_address, shipping_city, shipping_postcode, status, created_at, order_items(id, product_id, quantity_requested, quantity_picked, quantity_reserved)", { count: "exact" })
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);

  const orders = (data ?? []) as {
    id: string;
    order_number: string;
    platform: string;
    customer_name: string | null;
    status: string;
    created_at: string;
  }[];

  const { data: productData } = await supabase
    .from("products")
    .select("id, sku, name, unit_of_measure, is_serialized")
    .eq("org_id", ctx.org.id)
    .order("sku").limit(200);

  return (
    <div>
      <PageHeader title="Orders" subtitle={`Sales orders for ${ctx.org.code ?? "ORG"} · ${ctx.org.name}`} />

      <div className="p-8">
        <OrderManager orgId={ctx.org.id} orgName={ctx.org.name} canManage={ctx.role === "owner" || ctx.role === "manager"} initialOrders={orders as any[]} products={(productData ?? []) as any[]} page={page} total={count ?? 0} />
      </div>
    </div>
  );
}
