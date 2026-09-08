import { NextRequest, NextResponse } from "next/server";
import { CarrierService, CarrierServiceError } from "@/lib/carriers/carrier-service";
import { decryptCredentials } from "@/lib/carriers/crypto";
import type { CarrierSettings, ShipmentRequest } from "@/lib/carriers/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSafeText, isUuid } from "@/lib/validation";

export const runtime = "nodejs";

async function requireOrderManager(orgId: string) {
  const auth = createClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) throw new Error("Sign in again to continue.");
  const { data: membership, error } = await auth.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (error) throw error;
  if (!membership || !["owner", "manager"].includes((membership as { role: string }).role)) throw new Error("Manager or owner access is required.");
  // Keep this session-bound client for stock RPCs. Those database functions
  // deliberately check auth.uid() against the organization manager role.
  return { user, session: auth, admin: createAdminClient() };
}

function numberInRange(value: unknown, maximum: number, required = false) {
  if (value == null || value === "") return required ? null : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= maximum ? value : null;
}

function shipmentResponse(shipment: any, orderId: string) {
  return {
    awb: shipment.tracking_number,
    carrierStatus: shipment.status,
    labelUrl: `/api/orders/${encodeURIComponent(orderId)}/shipping-label`,
  };
}

function failure(error: unknown, fallback = "Unable to generate the carrier label.") {
  const message = error instanceof Error ? error.message : fallback;
  const safePrefixes = [
    "Sign in again to continue.", "Manager or owner access is required.", "Invalid", "Order not found", "Only allocated", "Shipping address", "Customer", "The selected carrier", "DHL", "Ninja", "Carrier credential", "Carrier integration", "CARRIER_CREDENTIALS", "Stored carrier credentials", "Shipping label created",
  ];
  return NextResponse.json({ error: safePrefixes.some((prefix) => message.startsWith(prefix)) ? message : fallback }, { status: message.includes("access") ? 403 : message.includes("not found") ? 404 : 400 });
}

export async function POST(request: NextRequest, { params }: { params: { orderId: string } }) {
  const rate = checkRateLimit(request, "carrier-awb-create", 20, 10 * 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many label requests. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(params.orderId) || !isUuid(body?.orgId) || !isUuid(body?.carrierId)) throw new Error("Invalid shipment request.");
    const weightKg = numberInRange(body.weightKg, 10_000, true);
    const lengthCm = numberInRange(body.lengthCm, 1_000);
    const widthCm = numberInRange(body.widthCm, 1_000);
    const heightCm = numberInRange(body.heightCm, 1_000);
    if (weightKg == null || lengthCm === null || widthCm === null || heightCm === null || (body.serviceCode != null && !isSafeText(body.serviceCode, 100))) throw new Error("Invalid parcel dimensions or weight.");
    const serials = body?.serials ?? [];
    if (!Array.isArray(serials) || serials.length > 100_000 || !serials.every((serial: unknown) => typeof serial === "object" && serial !== null && isUuid((serial as { orderItemId?: unknown }).orderItemId) && isSafeText((serial as { serialNumber?: unknown }).serialNumber, 160, true))) throw new Error("Invalid serial number shipment data.");

    const { user, session, admin } = await requireOrderManager(body.orgId);
    const { data: order, error: orderError } = await (admin.from("sales_orders") as any)
      .select("id, org_id, order_number, customer_name, shipping_address, shipping_city, shipping_postcode, status, order_items(id, quantity_requested)")
      .eq("id", params.orderId).eq("org_id", body.orgId).maybeSingle();
    if (orderError) throw orderError;
    if (!order) throw new Error("Order not found in the active organization.");
    if (!["ALLOCATED", "SHIPPED"].includes(order.status)) throw new Error("Only allocated sales orders can be shipped.");
    if (!order.customer_name?.trim()) throw new Error("Customer details are required before generating an AWB.");
    if (!order.shipping_address?.trim()) throw new Error("Shipping address is required before generating an AWB.");

    let { data: shipment, error: shipmentReadError } = await (admin.from("carrier_shipments") as any)
      .select("id, tracking_number, status, label_data, label_content_type, carrier_id, service_code")
      .eq("sales_order_id", order.id).eq("organization_id", body.orgId).maybeSingle();
    if (shipmentReadError) throw shipmentReadError;

    if (!shipment) {
      const { data: carrier, error: carrierError } = await (admin.from("carriers") as any)
        .select("id, organization_id, carrier_code, display_name, is_active, is_sandbox, encrypted_credentials")
        .eq("id", body.carrierId).eq("organization_id", body.orgId).maybeSingle();
      if (carrierError) throw carrierError;
      if (!carrier || !carrier.is_active) throw new Error("The selected carrier is unavailable for this organization.");
      const requestData: ShipmentRequest = {
        orderId: order.id,
        orderNumber: order.order_number,
        customerName: order.customer_name.trim(),
        shippingAddress: order.shipping_address.trim(),
        shippingCity: order.shipping_city?.trim() ?? "",
        shippingPostcode: order.shipping_postcode?.trim() ?? "",
        itemCount: (order.order_items ?? []).reduce((total: number, item: { quantity_requested: number }) => total + item.quantity_requested, 0),
        weightKg,
        ...(lengthCm ? { lengthCm } : {}), ...(widthCm ? { widthCm } : {}), ...(heightCm ? { heightCm } : {}),
        ...(body.serviceCode?.trim() ? { serviceCode: body.serviceCode.trim() } : {}),
      };
      const result = await CarrierService.createShipment(carrier as CarrierSettings, carrier.carrier_code === "MANUAL" ? {} : decryptCredentials(carrier.encrypted_credentials), requestData);
      const { data: inserted, error: insertError } = await (admin.from("carrier_shipments") as any)
        .insert({ organization_id: body.orgId, sales_order_id: order.id, carrier_id: carrier.id, service_code: result.serviceCode, tracking_number: result.trackingNumber, status: result.carrierStatus, provider_status: result.carrierStatus, label_data: result.labelBase64, label_content_type: result.labelContentType, created_by: user.id, updated_by: user.id })
        .select("id, tracking_number, status, label_data, label_content_type, carrier_id, service_code").single();
      if (insertError) throw insertError;
      shipment = inserted;
    }

    if (order.status === "ALLOCATED") {
      const { error: fulfillError } = await (session.rpc as any)("fulfill_sales_order_with_serials", {
        p_sales_order_id: order.id,
        p_serials: serials.map((serial: { orderItemId: string; serialNumber: string }) => ({ order_item_id: serial.orderItemId, serial_number: serial.serialNumber.trim().toUpperCase() })),
      });
      if (fulfillError) {
        throw new Error("Shipping label created, but inventory fulfillment was not completed. Correct the allocation or serial selections and try again; the existing label will be reused.");
      }
    }

    const { error: shipmentUpdateError } = await (admin.from("carrier_shipments") as any)
      .update({ status: "SHIPPED", provider_status: "SHIPPED", updated_by: user.id })
      .eq("id", shipment.id).eq("organization_id", body.orgId);
    if (shipmentUpdateError) throw shipmentUpdateError;
    const { error: orderUpdateError } = await (admin.from("sales_orders") as any)
      .update({ carrier_id: shipment.carrier_id, carrier_service: shipment.service_code, tracking_number: shipment.tracking_number, carrier_status: "SHIPPED", updated_by: user.id })
      .eq("id", order.id).eq("org_id", body.orgId);
    if (orderUpdateError) throw orderUpdateError;
    return NextResponse.json(shipmentResponse({ ...shipment, status: "SHIPPED" }, order.id));
  } catch (error) {
    return failure(error instanceof CarrierServiceError ? error : error);
  }
}
