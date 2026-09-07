import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { isPositiveInteger, isSafeText, isUuid } from "@/lib/validation";

async function requirePurchaseOrderManager(orgId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: membership, error } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!membership || !["owner", "manager"].includes((membership as { role: string }).role)) throw new Error("Manager or owner access is required.");
  return supabase;
}

function responseError(error: unknown, fallback = "Unable to process the purchase order.") {
  const message = error instanceof Error ? error.message : fallback;
  const status = message === "Unauthorized" ? 401 : message.includes("access") ? 403 : 400;
  const safePrefixes = ["Unauthorized", "Manager or owner access is required.", "Purchase order not found", "Only pending", "Invalid ", "Add at least one"];
  const safeMessage = safePrefixes.some((prefix) => message.startsWith(prefix)) ? message : fallback;
  return NextResponse.json({ error: safeMessage }, { status });
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "purchase-order-create", 30, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many purchase-order requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    const validLines = Array.isArray(body?.lines) && body.lines.length >= 1 && body.lines.length <= 100 && body.lines.every((line: unknown) => typeof line === "object" && line !== null && isUuid((line as { productId?: unknown }).productId) && isUuid((line as { locationId?: unknown }).locationId) && isPositiveInteger((line as { quantity?: unknown }).quantity, 100_000));
    if (!isUuid(body?.orgId) || !isSafeText(body?.supplierName, 100, true) || !validLines) throw new Error("Invalid purchase order details.");
    const supabase = await requirePurchaseOrderManager(body.orgId);
    const { data: id, error } = await (supabase.rpc as any)("create_purchase_order_with_lines", { p_org_id: body.orgId, p_supplier_name: body.supplierName.trim(), p_lines: body.lines });
    if (error) throw error;
    const { data: order, error: readError } = await (supabase.from("purchase_orders") as any).select("id, po_number, supplier_name, status, created_at, purchase_order_items(id, product_id, location_id, quantity_expected, quantity_received)").eq("id", id).eq("org_id", body.orgId).single();
    if (readError) throw readError;
    return NextResponse.json({ order });
  } catch (error) { return responseError(error); }
}

export async function PATCH(request: NextRequest) {
  const rate = checkRateLimit(request, "purchase-order-receive", 60, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many receipt requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(body?.orgId) || !isUuid(body?.orderId) || body?.action !== "receive") throw new Error("Invalid purchase-order action.");
    const supabase = await requirePurchaseOrderManager(body.orgId);
    const { data: order, error: scopeError } = await (supabase.from("purchase_orders") as any).select("id").eq("id", body.orderId).eq("org_id", body.orgId).maybeSingle();
    if (scopeError) throw scopeError;
    if (!order) throw new Error("Purchase order not found in the active organization.");
    const { error } = await (supabase.rpc as any)("receive_purchase_order", { p_purchase_order_id: body.orderId });
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return responseError(error); }
}
