import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeText, isUuid } from "@/lib/validation";

// Keep the native select lightweight. Barcode scanning and the batch endpoint
// remain available for every valid serial, regardless of this preview cap.
const MAX_SERIAL_OPTIONS = 100;

export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId");
  const orderId = request.nextUrl.searchParams.get("orderId");
  const orderItemId = request.nextUrl.searchParams.get("orderItemId");
  const serialNumber = request.nextUrl.searchParams.get("serialNumber")?.trim().toUpperCase();
  if (!isUuid(orgId) || !isUuid(orderId)) return NextResponse.json({ error: "Invalid shipment request." }, { status: 400 });
  if ((orderItemId || serialNumber) && (!isUuid(orderItemId) || !isSafeText(serialNumber, 160, true))) return NextResponse.json({ error: "Invalid serial number scan." }, { status: 400 });

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { data: membership } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "manager"].includes((membership as { role: string }).role)) return NextResponse.json({ error: "Manager or owner access is required." }, { status: 403 });

  const { data: order, error } = await (supabase.from("sales_orders") as any)
    .select("id, order_number, customer_name, shipping_address, shipping_city, shipping_postcode, status, order_items(id, product_id, quantity_requested, quantity_reserved, products(id, sku, name, is_serialized), order_item_allocations(quantity_reserved, inventory_balances(location_id, locations(display_code, location_code))))")
    .eq("id", orderId).eq("org_id", orgId).maybeSingle();
  if (error) return NextResponse.json({ error: "Unable to load shipment details." }, { status: 500 });
  if (!order) return NextResponse.json({ error: "Order not found in the active organization." }, { status: 404 });

  // Scanner verification is intentionally server-side. A serial is only
  // accepted by the drawer when it is active and belongs to an allocated bin.
  if (orderItemId && serialNumber) {
    const line = (order.order_items ?? []).find((item: any) => item.id === orderItemId);
    const locationIds = [...new Set((line?.order_item_allocations ?? []).map((allocation: any) => allocation.inventory_balances?.location_id).filter(Boolean))];
    if (!line?.products?.is_serialized || !locationIds.length) return NextResponse.json({ error: "This serialised line does not have an allocated bin." }, { status: 400 });
    const { data: serial, error: serialError } = await (supabase.from("serial_numbers") as any)
      .select("serial_number, product_id, location_id")
      .eq("org_id", orgId).eq("product_id", line.product_id).eq("status", "IN_STOCK")
      .eq("serial_number", serialNumber).in("location_id", locationIds).maybeSingle();
    if (serialError) return NextResponse.json({ error: "Unable to verify the serial number." }, { status: 500 });
    if (!serial) return NextResponse.json({ error: "That serial is not active in an allocated bin for this order." }, { status: 400 });
    return NextResponse.json({ serial });
  }

  const serializedLines = (order.order_items ?? []).filter((line: any) => line.products?.is_serialized);
  const productIds = [...new Set(serializedLines.map((line: any) => line.product_id))];
  const locationIds = [...new Set(serializedLines.flatMap((line: any) => (line.order_item_allocations ?? []).map((allocation: any) => allocation.inventory_balances?.location_id).filter(Boolean)))];
  const { data: serials, error: serialError } = productIds.length && locationIds.length
    ? await (supabase.from("serial_numbers") as any).select("serial_number, product_id, location_id").eq("org_id", orgId).eq("status", "IN_STOCK").in("product_id", productIds).in("location_id", locationIds).order("serial_number").limit(MAX_SERIAL_OPTIONS)
    : { data: [], error: null };
  if (serialError) return NextResponse.json({ error: "Unable to load available serial numbers." }, { status: 500 });
  const { data: warehouses, error: warehouseError } = order.status === "NEW"
    ? await supabase.from("warehouses").select("id").eq("org_id", orgId)
    : { data: [], error: null };
  if (warehouseError) return NextResponse.json({ error: "Unable to load picking locations." }, { status: 500 });
  const warehouseIds = (warehouses ?? []).map((warehouse: { id: string }) => warehouse.id);
  const { data: zones, error: zoneError } = warehouseIds.length && order.status === "NEW"
    ? await supabase.from("warehouse_zones").select("id").in("warehouse_id", warehouseIds).eq("zone_type", "PICKING")
    : { data: [], error: null };
  if (zoneError) return NextResponse.json({ error: "Unable to load picking locations." }, { status: 500 });
  const { data: pickingRows, error: pickingError } = (zones ?? []).length
    ? await supabase.from("locations").select("id, display_code, location_code").in("zone_id", (zones ?? []).map((zone: { id: string }) => zone.id)).eq("is_active", true).order("location_code").limit(500)
    : { data: [], error: null };
  if (pickingError) return NextResponse.json({ error: "Unable to load picking locations." }, { status: 500 });
  const pickingLocations = (pickingRows ?? []).map((location: any) => ({ id: location.id, code: location.display_code ?? location.location_code }));
  return NextResponse.json({ order, serials: serials ?? [], pickingLocations, truncated: (serials?.length ?? 0) === MAX_SERIAL_OPTIONS });
}

// A pasted scanner batch used to issue one GET (and reload the entire order)
// per serial. Validate a bounded batch in one scoped query instead.
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const orgId = body?.orgId;
  const orderId = body?.orderId;
  const orderItemId = body?.orderItemId;
  const rawSerialNumbers: unknown[] = Array.isArray(body?.serialNumbers) ? body.serialNumbers : [];
  const serialNumbers: string[] = [...new Set(rawSerialNumbers.map((value) => typeof value === "string" ? value.trim().toUpperCase() : "").filter((value): value is string => Boolean(value)))];
  if (!isUuid(orgId) || !isUuid(orderId) || !isUuid(orderItemId) || !serialNumbers.length || serialNumbers.length > 500 || !serialNumbers.every((serial: string) => isSafeText(serial, 160, true))) return NextResponse.json({ error: "Invalid serial number scan." }, { status: 400 });

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { data: membership } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "manager"].includes((membership as { role: string }).role)) return NextResponse.json({ error: "Manager or owner access is required." }, { status: 403 });

  const { data: line, error: lineError } = await (supabase.from("order_items") as any)
    .select("id, product_id, products!inner(is_serialized), sales_orders!inner(org_id), order_item_allocations(quantity_reserved, inventory_balances(location_id))")
    .eq("id", orderItemId).eq("sales_order_id", orderId).eq("sales_orders.org_id", orgId).maybeSingle();
  if (lineError) return NextResponse.json({ error: "Unable to verify serial numbers." }, { status: 500 });
  const locationIds = [...new Set((line?.order_item_allocations ?? []).map((allocation: any) => allocation.inventory_balances?.location_id).filter(Boolean))];
  if (!line?.products?.is_serialized || !locationIds.length) return NextResponse.json({ error: "This serialised line does not have an allocated bin." }, { status: 400 });

  const { data: rows, error } = await (supabase.from("serial_numbers") as any)
    .select("serial_number")
    .eq("org_id", orgId).eq("product_id", line.product_id).eq("status", "IN_STOCK")
    .in("serial_number", serialNumbers).in("location_id", locationIds);
  if (error) return NextResponse.json({ error: "Unable to verify serial numbers." }, { status: 500 });
  const accepted = (rows ?? []).map((row: { serial_number: string }) => row.serial_number);
  const acceptedSet = new Set(accepted);
  const rejected = serialNumbers.filter((serial: string) => !acceptedSet.has(serial));
  if (rejected.length) {
    // The client keeps the invalid scan out of the fulfillment selection; this
    // audit record makes wrong-serial attempts visible to managers.
    await (supabase.rpc as any)("log_mispick_attempt", { p_org_id: orgId, p_sales_order_id: orderId, p_order_item_id: orderItemId, p_scanned_value: rejected[0], p_reason_code: "WRONG_SERIAL" });
  }
  return NextResponse.json({ accepted, rejected });
}
