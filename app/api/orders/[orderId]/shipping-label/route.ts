import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

export const runtime = "nodejs";

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
