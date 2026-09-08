import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

const PAGE_SIZE = 100;

// Bin details are deliberately loaded only after a user opens SKU details.
// The Inventory list itself stays compact regardless of warehouse size.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId");
  const productId = request.nextUrl.searchParams.get("productId");
  if (!isUuid(orgId) || !isUuid(productId)) {
    return NextResponse.json({ error: "Invalid inventory request." }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const [{ data: membership }, { data: product }] = await Promise.all([
    supabase.from("org_members").select("org_id").eq("org_id", orgId).eq("user_id", user.id).maybeSingle(),
    supabase.from("products").select("id, is_serialized").eq("id", productId).eq("org_id", orgId).maybeSingle(),
  ]);
  if (!membership || !product) return NextResponse.json({ error: "Inventory item was not found." }, { status: 404 });

  const [{ data, count, error }, { data: inboundRows, error: inboundError }] = await Promise.all([
    supabase
      .from("inventory_balances")
      .select("location_id, quantity_on_hand, quantity_reserved, locations(location_code, display_code, warehouse_zones(zone_code, warehouses(code, name)))", { count: "exact" })
      .eq("product_id", productId)
      .or("quantity_on_hand.neq.0,quantity_reserved.neq.0")
      .order("updated_at", { ascending: false })
      .limit(PAGE_SIZE),
    (supabase.from("purchase_order_items") as any)
      .select("location_id, quantity_expected, quantity_received, locations(location_code, display_code, warehouse_zones(zone_code, warehouses(code, name))), purchase_orders!inner(org_id, status)")
      .eq("product_id", productId)
      .eq("purchase_orders.org_id", orgId)
      .in("purchase_orders.status", ["DRAFT", "PENDING"])
      .limit(PAGE_SIZE),
  ]);
  if (error) return NextResponse.json({ error: "Unable to load stock details." }, { status: 500 });
  if (inboundError) return NextResponse.json({ error: "Unable to load inbound stock details." }, { status: 500 });

  // Serial data is intentionally retrieved only for an opened serialized SKU.
  // Both predicates are retained here (as well as RLS) to preserve tenant isolation.
  let serials: Array<{ serialNumber: string; locationCode: string }> = [];
  const serialsByLocation = new Map<string, string[]>();
  let serialTotal = 0;
  const isSerialized = Boolean((product as unknown as { is_serialized?: boolean }).is_serialized);
  if (isSerialized) {
    const { data: serialRows, count: serialCount, error: serialError } = await supabase
      .from("serial_numbers")
      .select("serial_number, location_id, locations(location_code, display_code)", { count: "exact" })
      .eq("org_id", orgId)
      .eq("product_id", productId)
      .eq("status", "IN_STOCK")
      .order("serial_number", { ascending: true })
      .limit(PAGE_SIZE);
    if (serialError) return NextResponse.json({ error: "Unable to load available serial numbers." }, { status: 500 });
    serials = (serialRows ?? []).map((serial: any) => ({
      serialNumber: serial.serial_number,
      locationCode: serial.locations?.display_code ?? serial.locations?.location_code ?? "Unknown bin",
    }));
    (serialRows ?? []).forEach((serial: any) => {
      const entries = serialsByLocation.get(serial.location_id) ?? [];
      entries.push(serial.serial_number);
      serialsByLocation.set(serial.location_id, entries);
    });
    serialTotal = serialCount ?? 0;
  }

  return NextResponse.json({
    stock: [...[...(data ?? []).reduce((byLocation: Map<string, any>, balance: any) => {
      const existing = byLocation.get(balance.location_id) ?? { locationId: balance.location_id, locationCode: balance.locations?.display_code ?? balance.locations?.location_code ?? "Unknown bin", zoneCode: balance.locations?.warehouse_zones?.zone_code ?? "Unknown zone", warehouseName: balance.locations?.warehouse_zones?.warehouses?.name ?? balance.locations?.warehouse_zones?.warehouses?.code ?? "Unknown warehouse", onHand: 0, reserved: 0, serialNumbers: serialsByLocation.get(balance.location_id) ?? [] };
      existing.onHand += Number(balance.quantity_on_hand);
      existing.reserved += Number(balance.quantity_reserved);
      byLocation.set(balance.location_id, existing);
      return byLocation;
    }, new Map<string, any>()).entries(), ...(inboundRows ?? []).map((row: any) => [row.location_id, row] as const)].reduce((byLocation: Map<string, any>, entry: any) => {
      const [locationId, inbound] = entry;
      const existing = byLocation.get(locationId) ?? { locationId, locationCode: inbound.locations?.display_code ?? inbound.locations?.location_code ?? "Unknown bin", zoneCode: inbound.locations?.warehouse_zones?.zone_code ?? "Unknown zone", warehouseName: inbound.locations?.warehouse_zones?.warehouses?.name ?? inbound.locations?.warehouse_zones?.warehouses?.code ?? "Unknown warehouse", onHand: 0, reserved: 0, serialNumbers: serialsByLocation.get(locationId) ?? [] };
      if (inbound.quantity_expected != null) existing.inbound = (existing.inbound ?? 0) + Math.max(0, Number(inbound.quantity_expected) - Number(inbound.quantity_received));
      byLocation.set(locationId, existing);
      return byLocation;
    }, new Map<string, any>()).values()].map((balance: any) => ({ ...balance, available: balance.onHand - balance.reserved, inbound: balance.inbound ?? 0 })),
    total: count ?? 0,
    serials,
    serialTotal,
  });
}
