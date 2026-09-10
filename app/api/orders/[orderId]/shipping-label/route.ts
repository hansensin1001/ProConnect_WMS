import { NextRequest, NextResponse } from "next/server";
import { createProfessionalThermalLabelPdf } from "@/lib/carriers/professional-label";
import type { ShipmentRequest } from "@/lib/carriers/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";

function labelUrl(orderId: string) {
  return `/api/orders/${encodeURIComponent(orderId)}/shipping-label`;
}

export async function GET(request: NextRequest, { params }: { params: { orderId: string } }) {
  const rate = checkRateLimit(request, "carrier-label-read", 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    if (!isUuid(params.orderId)) return NextResponse.json({ error: "Invalid order." }, { status: 400 });
    const auth = createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
    // This request uses the session-bound client for the order lookup, so RLS
    // confirms the viewer belongs to the order's organization before the
    // service client can read the private PDF payload.
    const { data: order, error: orderError } = await (auth.from("sales_orders") as any)
      .select("id, org_id, order_number").eq("id", params.orderId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });
    const admin = createAdminClient();
    const { data: shipment, error: shipmentError } = await (admin.from("carrier_shipments") as any)
      .select("label_data, label_content_type, tracking_number").eq("sales_order_id", order.id).eq("organization_id", order.org_id).maybeSingle();
    if (shipmentError) throw shipmentError;
    if (!shipment?.label_data) return NextResponse.json({ error: "No shipping label has been generated for this order." }, { status: 404 });
    const filename = `${String(order.order_number).replace(/[^A-Za-z0-9_-]/g, "_")}-${String(shipment.tracking_number).replace(/[^A-Za-z0-9_-]/g, "_")}.pdf`;
    return new NextResponse(Buffer.from(shipment.label_data, "base64"), {
      headers: {
        "Content-Type": shipment.label_content_type === "application/pdf" ? "application/pdf" : "application/octet-stream",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Unable to load the shipping label." }, { status: 500 });
  }
}

/**
 * Reprint the current 4x6 WMS label without allocating, fulfilling, or
 * creating another carrier shipment. Manual and sandbox labels are safely
 * rendered again from the original AWB; a production-carrier PDF is preserved
 * exactly as returned by the carrier.
 */
export async function POST(request: NextRequest, { params }: { params: { orderId: string } }) {
  const rate = checkRateLimit(request, "carrier-label-reprint", 30, 10 * 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many reprint requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(params.orderId) || !isUuid(body?.orgId)) return NextResponse.json({ error: "Invalid reprint request." }, { status: 400 });
    const auth = createClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in again to continue." }, { status: 401 });
    const { data: order, error: orderError } = await (auth.from("sales_orders") as any)
      .select("id, org_id, order_number, customer_name, shipping_address, shipping_city, shipping_postcode, order_items(quantity_requested)")
      .eq("id", params.orderId).eq("org_id", body.orgId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) return NextResponse.json({ error: "Order not found." }, { status: 404 });

    const admin = createAdminClient();
    const { data: shipment, error: shipmentError } = await (admin.from("carrier_shipments") as any)
      .select("id, carrier_id, tracking_number, label_data").eq("sales_order_id", order.id).eq("organization_id", order.org_id).maybeSingle();
    if (shipmentError) throw shipmentError;
    if (!shipment?.label_data || !shipment.tracking_number) return NextResponse.json({ error: "No shipping label has been generated for this order." }, { status: 404 });

    const { data: carrier, error: carrierError } = await (admin.from("carriers") as any)
      .select("carrier_code, display_name, is_sandbox").eq("id", shipment.carrier_id).eq("organization_id", order.org_id).maybeSingle();
    if (carrierError) throw carrierError;

    // Provider-generated labels must remain byte-for-byte intact. All current
    // manual and sandbox adapters use our printable WMS template, so they can
    // be regenerated to pick up template fixes without changing the AWB.
    const canRegenerate = carrier?.carrier_code === "MANUAL" || Boolean(carrier?.is_sandbox);
    if (canRegenerate) {
      const [{ data: organization, error: organizationError }, { data: warehouse, error: warehouseError }] = await Promise.all([
        (admin.from("organizations") as any).select("name, code").eq("id", order.org_id).maybeSingle(),
        (admin.from("warehouses") as any).select("name, code, address").eq("org_id", order.org_id).order("code").limit(1).maybeSingle(),
      ]);
      if (organizationError || warehouseError) throw organizationError ?? warehouseError;
      const itemCount = (order.order_items ?? []).reduce((total: number, item: { quantity_requested: number }) => total + Number(item.quantity_requested || 0), 0);
      const labelInput: ShipmentRequest = {
        orderId: order.id,
        orderNumber: order.order_number,
        senderName: organization?.name ?? "ProConnect WMS",
        senderAddress: [warehouse?.name, warehouse?.address?.trim() || warehouse?.code || organization?.code].filter(Boolean).join(", "),
        customerName: order.customer_name?.trim() || "Customer",
        shippingAddress: order.shipping_address?.trim() || "Address not recorded",
        shippingCity: order.shipping_city?.trim() ?? "",
        shippingPostcode: order.shipping_postcode?.trim() ?? "",
        itemCount,
        weightKg: 0.5,
        serviceCode: carrier?.carrier_code === "MANUAL" ? "MANUAL" : "STANDARD",
      };
      const labelData = createProfessionalThermalLabelPdf(labelInput, carrier?.display_name ?? "Manual shipment", shipment.tracking_number);
      const { error: updateError } = await (admin.from("carrier_shipments") as any)
        .update({ label_data: labelData, label_content_type: "application/pdf", updated_by: user.id })
        .eq("id", shipment.id).eq("organization_id", order.org_id);
      if (updateError) throw updateError;
    }
    return NextResponse.json({ labelUrl: labelUrl(order.id), awb: shipment.tracking_number, regenerated: canRegenerate });
  } catch {
    return NextResponse.json({ error: "Unable to prepare the shipping label for reprint." }, { status: 500 });
  }
}
