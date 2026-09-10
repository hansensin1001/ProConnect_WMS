import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { OrderManager } from "@/components/OrderManager";
import { DocumentListFilters } from "@/components/DocumentListFilters";

const PAGE_SIZE = 50;
export default async function OrdersPage({ searchParams }: { searchParams?: { page?: string; q?: string; status?: string } }) {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const query = (searchParams?.q ?? "").trim().slice(0, 80).replace(/[,%()]/g, "");
  const status = (searchParams?.status ?? "").trim();
  const from = (page - 1) * PAGE_SIZE;
  let salesOrderQuery: any = supabase
      .from("sales_orders")
      .select("id, order_number, platform, customer_name, shipping_address, shipping_city, shipping_postcode, status, created_at, carrier_id, carrier_service, tracking_number, carrier_status, order_items(id, product_id, quantity_requested, quantity_picked, quantity_reserved)", { count: "exact" })
      .eq("org_id", ctx.org.id)
      .order("created_at", { ascending: false });
  if (query) salesOrderQuery = salesOrderQuery.or(`order_number.ilike.%${query}%,customer_name.ilike.%${query}%,tracking_number.ilike.%${query}%`);
  if (["DRAFT","NEW","ALLOCATED","PARTIALLY_SHIPPED","SHIPPED","REVERTED","CANCELLED"].includes(status)) salesOrderQuery = salesOrderQuery.eq("status", status);
  const [{ data, count }, { data: productData }] = await Promise.all([
    salesOrderQuery.range(from, from + PAGE_SIZE - 1),
    supabase
      .from("products")
      .select("id, sku, name, unit_of_measure, is_serialized")
      .eq("org_id", ctx.org.id)
      .order("sku").limit(200),
  ]);

  const orders = (data ?? []) as {
    id: string;
    order_number: string;
    platform: string;
    customer_name: string | null;
    status: string;
    created_at: string;
  }[];

  return (
    <div>
      <PageHeader title="Orders" subtitle={`Sales orders for ${ctx.org.code ?? "ORG"} · ${ctx.org.name}`} />

      <div className="p-8">
        <DocumentListFilters initialQuery={query} initialStatus={status} placeholder="Search SO, customer, or tracking number" statuses={["DRAFT","NEW","ALLOCATED","PARTIALLY_SHIPPED","SHIPPED","REVERTED","CANCELLED"]}/>
        <OrderManager orgId={ctx.org.id} orgName={ctx.org.name} canManage={ctx.role === "owner" || ctx.role === "manager"} initialOrders={orders as any[]} products={(productData ?? []) as any[]} page={page} total={count ?? 0} />
      </div>
    </div>
  );
}
