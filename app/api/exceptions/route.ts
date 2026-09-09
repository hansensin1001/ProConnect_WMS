import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { isPositiveInteger, isSafeText, isUuid } from "@/lib/validation";

async function requireManager(orgId: string) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");
  const { data: member } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (!member || !["owner", "manager"].includes((member as { role: string }).role)) throw new Error("Manager or owner access is required.");
  return supabase;
}

function validLines(lines: unknown, extra = false) {
  return Array.isArray(lines) && lines.length > 0 && lines.length <= 100 && lines.every((line) => typeof line === "object" && line !== null && isUuid((line as any).productId) && isUuid((line as any).locationId) && isPositiveInteger((line as any).quantity, 100_000) && (!extra || isSafeText((line as any).reason, 250, true)));
}
function fail(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process the exception workflow.";
  // These are operational messages shown only after the caller passed the
  // manager authorization check. They make incomplete SQL deployments and
  // invalid exception actions actionable without exposing credentials.
  const safe = /^(Unauthorized|Manager or owner access is required|Invalid|Purchase order|Sales order|RTV|Cycle count|A reason|Only |RTV quantity|insufficient|received quantity|serialised|function |relation |column |permission denied|new row|duplicate key|cycle count has)/i.test(message);
  return NextResponse.json({ error: safe ? message : "Unable to process the exception workflow." }, { status: message.includes("access") ? 403 : 400 });
}

export async function GET(request: NextRequest) {
  try {
    const orgId = new URL(request.url).searchParams.get("orgId"); if (!isUuid(orgId)) throw new Error("Invalid organization.");
    const supabase = await requireManager(orgId);
    const [mispicks, rtvs, rmas, counts] = await Promise.all([
      (supabase.from("mispick_attempts") as any).select("id, scanned_value, reason_code, created_at, sales_orders(order_number), products(sku)").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
      (supabase.from("return_to_vendor") as any).select("id, rtv_number, supplier_name, status, created_at").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
      (supabase.from("rmas") as any).select("id, rma_number, customer_name, status, created_at, sales_orders(order_number)").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
      (supabase.from("cycle_counts") as any).select("id, count_number, status, counted_at, cycle_count_items(id, system_quantity, physical_quantity, reason_code, products(sku, name), locations(location_code, display_code))").eq("org_id", orgId).order("created_at", { ascending: false }).limit(50),
    ]);
    for (const result of [mispicks, rtvs, rmas, counts]) if (result.error) throw result.error;
    return NextResponse.json({ mispicks: mispicks.data ?? [], rtvs: rtvs.data ?? [], rmas: rmas.data ?? [], cycleCounts: counts.data ?? [] });
  } catch (error) { return fail(error); }
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "exception-workflow", 60, 60_000); if (!rate.allowed) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429 });
  try {
    const body = await request.json(); if (!isUuid(body?.orgId) || typeof body?.action !== "string") throw new Error("Invalid exception request.");
    const supabase = await requireManager(body.orgId); let data: unknown; let error: unknown;
    if (body.action === "partialReceipt") {
      if (!isUuid(body.orderId) || !Array.isArray(body.receipts) || !body.receipts.every((item: any) => isUuid(item.purchaseOrderItemId) && isPositiveInteger(item.quantity, 100_000) && ["AVAILABLE", "QUARANTINE"].includes(item.disposition))) throw new Error("Invalid receipt lines.");
      ({ data, error } = await (supabase.rpc as any)("receive_purchase_order_partial", { p_purchase_order_id: body.orderId, p_receipts: body.receipts.map((item: any) => ({ purchase_order_item_id: item.purchaseOrderItemId, quantity: item.quantity, disposition: item.disposition })) }));
    } else if (body.action === "createRtv") {
      if (!isSafeText(body.supplierName, 100, true) || !validLines(body.lines, true)) throw new Error("Invalid RTV lines.");
      ({ data, error } = await (supabase.rpc as any)("create_return_to_vendor", { p_org_id: body.orgId, p_supplier_name: body.supplierName.trim(), p_lines: body.lines.map((line: any) => ({ product_id: line.productId, location_id: line.locationId, quantity: line.quantity, reason: line.reason.trim() })) }));
    } else if (body.action === "dispatchRtv") {
      if (!isUuid(body.rtvId)) throw new Error("Invalid RTV."); ({ data, error } = await (supabase.rpc as any)("dispatch_return_to_vendor", { p_rtv_id: body.rtvId }));
    } else if (body.action === "createRma") {
      if ((body.salesOrderId != null && !isUuid(body.salesOrderId)) || !validLines(body.lines, true) || !body.lines.every((line: any) => ["QUARANTINE", "REPAIR"].includes(line.disposition))) throw new Error("Invalid RMA lines.");
      ({ data, error } = await (supabase.rpc as any)("create_rma_and_receive", { p_org_id: body.orgId, p_sales_order_id: body.salesOrderId ?? null, p_customer_name: isSafeText(body.customerName, 100) ? body.customerName.trim() : "", p_lines: body.lines.map((line: any) => ({ product_id: line.productId, location_id: line.locationId, quantity: line.quantity, disposition: line.disposition, reason: line.reason.trim() })) }));
    } else if (body.action === "submitCycleCount") {
      if (!Array.isArray(body.lines) || !body.lines.length || !body.lines.every((line: any) => isUuid(line.productId) && isUuid(line.locationId) && Number.isInteger(line.physicalQuantity) && line.physicalQuantity >= 0 && (line.reasonCode == null || ["DAMAGED","MISSING","MISPLACED","COUNT_ERROR","OTHER"].includes(line.reasonCode)))) throw new Error("Invalid cycle-count lines.");
      ({ data, error } = await (supabase.rpc as any)("submit_cycle_count", { p_org_id: body.orgId, p_lines: body.lines.map((line: any) => ({ product_id: line.productId, location_id: line.locationId, physical_quantity: line.physicalQuantity, reason_code: line.reasonCode ?? "" })) }));
    } else if (body.action === "approveCycleCount") {
      if (!isUuid(body.cycleCountId) || typeof body.approve !== "boolean") throw new Error("Invalid cycle-count approval."); ({ data, error } = await (supabase.rpc as any)("approve_cycle_count", { p_cycle_count_id: body.cycleCountId, p_approve: body.approve }));
    } else if (body.action === "partialShip") {
      if (!isUuid(body.orderId) || !Array.isArray(body.lines) || !body.lines.every((line: any) => isUuid(line.orderItemId) && isPositiveInteger(line.quantity, 100_000))) throw new Error("Invalid shipment lines."); ({ data, error } = await (supabase.rpc as any)("fulfill_sales_order_partial", { p_sales_order_id: body.orderId, p_lines: body.lines.map((line: any) => ({ order_item_id: line.orderItemId, quantity: line.quantity })) }));
    } else if (body.action === "logMispick") {
      if (!isUuid(body.orderId) || !isUuid(body.orderItemId) || !isSafeText(body.scannedValue, 160, true) || !["WRONG_SKU","WRONG_SERIAL","WRONG_BIN","NOT_ALLOCATED"].includes(body.reasonCode)) throw new Error("Invalid mispick attempt."); ({ data, error } = await (supabase.rpc as any)("log_mispick_attempt", { p_org_id: body.orgId, p_sales_order_id: body.orderId, p_order_item_id: body.orderItemId, p_scanned_value: body.scannedValue, p_reason_code: body.reasonCode }));
    } else throw new Error("Invalid exception action.");
    if (error) throw error; return NextResponse.json({ ok: true, id: data ?? null });
  } catch (error) { return fail(error); }
}
