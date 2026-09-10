import { PageHeader } from "@/components/PageHeader";
import { getCurrentOrgContext } from "@/lib/org";
import { createClient } from "@/lib/supabase/server";
import { TraceabilityReportConsole } from "@/components/TraceabilityReportConsole";

const PAGE_SIZE = 50;
export default async function ReportsPage({ searchParams }: { searchParams?: { page?: string } }) {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();
  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const [{ data: stock }, { count: openOrders }, { data: movements, count: movementCount }, { data: serialRows }] = await Promise.all([
    supabase.from("inventory_balances").select("quantity_on_hand, quantity_reserved, products!inner(sku, name, org_id)").eq("products.org_id", ctx.org.id).limit(100),
    supabase.from("sales_orders").select("*", { count: "exact", head: true }).eq("org_id", ctx.org.id).in("status", ["NEW", "ALLOCATED", "PICKING"]),
    supabase.from("inventory_transactions").select("id, transaction_type, quantity_delta, reason, reference_type, created_at, products(sku, name), locations(location_code)", { count: "exact" }).eq("org_id", ctx.org.id).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1),
    supabase.from("serial_numbers").select("id, serial_number, status, received_at, shipped_at, products(sku, name), locations(location_code, display_code), purchase_orders(po_number), sales_orders(order_number)").eq("org_id", ctx.org.id).order("received_at", { ascending: false }).limit(200),
  ]);
  const stockLines = (stock ?? []) as any[];
  const movementRows = (movements ?? []) as any[];
  const totalOnHand = stockLines.reduce((sum, row) => sum + Number(row.quantity_on_hand || 0), 0);
  const totalReserved = stockLines.reduce((sum, row) => sum + Number(row.quantity_reserved || 0), 0);
  const pickedUnits = movementRows.filter((row) => row.transaction_type === "OUTBOUND").reduce((sum, row) => sum + Math.abs(Number(row.quantity_delta || 0)), 0);
  const serialEvents = (serialRows ?? []).flatMap((serial: any) => {
    const inbound = serial.received_at ? [{ id: `${serial.id}-in`, direction: "SERIAL_IN", occurredAt: serial.received_at, serialNumber: serial.serial_number, products: serial.products, locations: serial.locations, purchase_orders: serial.purchase_orders, sales_orders: serial.sales_orders }] : [];
    const outbound = serial.shipped_at ? [{ id: `${serial.id}-out`, direction: "SERIAL_OUT", occurredAt: serial.shipped_at, serialNumber: serial.serial_number, products: serial.products, locations: serial.locations, purchase_orders: serial.purchase_orders, sales_orders: serial.sales_orders }] : [];
    return [...inbound, ...outbound];
  }).sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());
  const { data: warehouseData, error: warehouseError } = await supabase.from("warehouses").select("id, code, name").eq("org_id", ctx.org.id).order("code");
  if (warehouseError) throw warehouseError;
  const warehouseIds = (warehouseData ?? []).map((warehouse: any) => warehouse.id);
  const { data: zoneData, error: zoneError } = warehouseIds.length
    ? await supabase.from("warehouse_zones").select("id, warehouse_id, zone_code").in("warehouse_id", warehouseIds).order("zone_code")
    : { data: [], error: null };
  if (zoneError) throw zoneError;
  const zoneIds = (zoneData ?? []).map((zone: any) => zone.id);
  const { data: locationData, error: locationError } = zoneIds.length
    ? await supabase.from("locations").select("id, zone_id, location_code, display_code").in("zone_id", zoneIds).eq("is_active", true).order("location_code").limit(500)
    : { data: [], error: null };
  if (locationError) throw locationError;

  return <div>
    <PageHeader title="Reports" subtitle="Live warehouse operations summary" />
    <div className="p-8 space-y-6">
      <TraceabilityReportConsole orgId={ctx.org.id} orgName={ctx.org.name} warehouses={(warehouseData ?? []) as any[]} zones={(zoneData ?? []) as any[]} locations={(locationData ?? []) as any[]} serialEvents={serialEvents} />
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
        {[['Units on hand', totalOnHand], ['Units reserved', totalReserved], ['Open orders', openOrders ?? 0], ['Units picked on this page', pickedUnits]].map(([label, value]) => (
          <div key={String(label)} className="border border-line border-l-4 border-l-rack bg-panel px-5 py-4">
            <div className="text-xs uppercase tracking-wide text-graphite">{label}</div>
            <div className="stencil mt-1 text-4xl">{value}</div>
          </div>
        ))}
      </div>
      <div className="border border-line bg-panel">
        <div className="border-b border-line px-5 py-3 text-sm font-medium">Inventory by SKU</div>
        <table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase text-graphite"><th className="px-5 py-3">SKU</th><th className="px-5 py-3">Product</th><th className="px-5 py-3 text-right">On hand</th><th className="px-5 py-3 text-right">Reserved</th></tr></thead>
          <tbody>{stockLines.map((row, index) => <tr key={index} className="border-t border-line"><td className="code-label px-5 py-3">{row.products?.sku ?? '—'}</td><td className="px-5 py-3">{row.products?.name ?? 'Unknown product'}</td><td className="px-5 py-3 text-right">{row.quantity_on_hand}</td><td className="px-5 py-3 text-right">{row.quantity_reserved}</td></tr>)}</tbody>
        </table>
      </div>
    </div>
  </div>;
}
