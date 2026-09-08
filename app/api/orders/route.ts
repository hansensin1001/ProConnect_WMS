import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isPositiveInteger, isSafeMultilineText, isSafeText, isUuid } from "@/lib/validation";

async function requireOrderManager(orgId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: membership, error } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!membership || !["owner", "manager"].includes((membership as { role: string }).role)) throw new Error("Manager or owner access is required.");
  return supabase;
}

function responseError(error: unknown, fallback = "Unable to process the order.") {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : message.includes("access") ? 403 : 400;
  // PostgREST/database messages can reveal schema or policy details.  Keep the
  // deliberately raised, user-actionable messages and conceal all other errors.
  const safePrefixes = [
    "Unauthorized",
    "Manager or owner access is required.",
    "Order not found",
    "Only new orders can be allocated.",
    "Only allocated orders can be fulfilled.",
    "Only draft or new sales orders can be edited",
    "Only allocated or shipped sales orders can be rolled back",
    "Insufficient available stock",
    "Serial ",
    "serial ",
    "Duplicate ",
    "duplicate ",
    "Invalid ",
    "Customer",
    "At least one line item",
  ];
  const safeMessage = safePrefixes.some((prefix) => message.startsWith(prefix)) ? message : fallback;
  return NextResponse.json({ error: safeMessage }, { status });
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "sales-order-create", 30, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many order requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(body?.orgId) || !isSafeText(body.customerName, 100, true) || !isSafeText(body.platform, 50, true) || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100 || !body.lines.every((line: unknown) => typeof line === "object" && line !== null && isUuid((line as { productId?: unknown }).productId) && isPositiveInteger((line as { quantity?: unknown }).quantity, 100_000))) throw new Error("Invalid sales order details.");
    if ((body.shippingAddress != null && !isSafeMultilineText(body.shippingAddress, 500)) || (body.shippingCity != null && !isSafeText(body.shippingCity, 100)) || (body.shippingPostcode != null && !isSafeText(body.shippingPostcode, 20))) throw new Error("Invalid shipping details.");
    const supabase = await requireOrderManager(body.orgId);
    const { data: id, error } = await (supabase.rpc as any)("create_sales_order_with_lines", { p_org_id: body.orgId, p_customer_name: body.customerName.trim(), p_platform: body.platform.trim(), p_shipping_address: body.shippingAddress?.trim() || null, p_shipping_city: body.shippingCity?.trim() || null, p_shipping_postcode: body.shippingPostcode?.trim() || null, p_lines: body.lines });
    if (error) throw error;
    const { data: order, error: readError } = await (supabase.from("sales_orders") as any).select("id, order_number, platform, customer_name, shipping_address, shipping_city, shipping_postcode, status, created_at, order_items(id, product_id, quantity_requested, quantity_picked)").eq("id", id).eq("org_id", body.orgId).single();
    if (readError) throw readError;
    return NextResponse.json({ order });
  } catch (error) { return responseError(error); }
}

export async function PATCH(request: NextRequest) {
  const rate = checkRateLimit(request, "sales-order-transition", 60, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many order requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(body?.orgId) || !isUuid(body?.orderId)) throw new Error("Invalid order action.");
    const supabase = await requireOrderManager(body.orgId);
    const { data: order, error: scopeError } = await (supabase.from("sales_orders") as any).select("id").eq("id", body.orderId).eq("org_id", body.orgId).maybeSingle();
    if (scopeError) throw scopeError;
    if (!order) throw new Error("Order not found in the active organization.");
    let error;
    if (body.action === "update") {
      if (!isSafeText(body.customerName, 100, true) || !isSafeText(body.platform, 50, true) || !Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100 || !body.lines.every((line: unknown) => typeof line === "object" && line !== null && isUuid((line as { productId?: unknown }).productId) && isPositiveInteger((line as { quantity?: unknown }).quantity, 100_000))) throw new Error("Invalid sales order details.");
      if ((body.shippingAddress != null && !isSafeMultilineText(body.shippingAddress, 500)) || (body.shippingCity != null && !isSafeText(body.shippingCity, 100)) || (body.shippingPostcode != null && !isSafeText(body.shippingPostcode, 20))) throw new Error("Invalid shipping details.");
      ({ error } = await (supabase.rpc as any)("update_sales_order_with_lines", { p_sales_order_id: body.orderId, p_customer_name: body.customerName.trim(), p_platform: body.platform.trim(), p_shipping_address: body.shippingAddress?.trim() || null, p_shipping_city: body.shippingCity?.trim() || null, p_shipping_postcode: body.shippingPostcode?.trim() || null, p_lines: body.lines }));
    } else if (body.action === "rollback") {
      ({ error } = await (supabase.rpc as any)("rollback_sales_order", { p_sales_order_id: body.orderId }));
    } else if (["ALLOCATED", "SHIPPED"].includes(body.status)) {
      if (body.status === "ALLOCATED") {
        if (body.pickingLocationId != null && !isUuid(body.pickingLocationId)) throw new Error("Invalid picking location.");
        ({ error } = await (supabase.rpc as any)("allocate_sales_order", { p_sales_order_id: body.orderId, p_picking_location_id: body.pickingLocationId || null }));
      } else {
        const serials = body?.serials ?? [];
        const validSerials = Array.isArray(serials) && serials.length <= 100_000 && serials.every((serial: unknown) => typeof serial === "object" && serial !== null && isUuid((serial as { orderItemId?: unknown }).orderItemId) && isSafeText((serial as { serialNumber?: unknown }).serialNumber, 160, true));
        if (!validSerials) throw new Error("Invalid serial number shipment data.");
        ({ error } = await (supabase.rpc as any)("fulfill_sales_order_with_serials", { p_sales_order_id: body.orderId, p_serials: serials.map((serial: { orderItemId: string; serialNumber: string }) => ({ order_item_id: serial.orderItemId, serial_number: serial.serialNumber.trim().toUpperCase() })) }));
      }
    } else throw new Error("Invalid order action.");
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return responseError(error); }
}

export async function DELETE(request: NextRequest) {
  const rate = checkRateLimit(request, "sales-order-delete", 20, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many order requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    const orderId = new URL(request.url).searchParams.get("orderId");
    if (!isUuid(orgId) || !isUuid(orderId)) throw new Error("Invalid order.");
    const supabase = await requireOrderManager(orgId);
    const { error } = await (supabase.from("sales_orders") as any).delete().eq("id", orderId).eq("org_id", orgId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return responseError(error); }
}
