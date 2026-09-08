import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { decryptCredentials } from "@/lib/carriers/crypto";
import { isCarrierCode } from "@/lib/carriers/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function verifiedSignature(rawBody: string, header: string | null, secret?: string) {
  if (!header || !secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
  const supplied = header.replace(/^sha256=/i, "").trim();
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer);
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim();
}

function trackingNumber(payload: any) {
  return firstString(payload?.tracking_number, payload?.trackingNumber, payload?.awb, payload?.waybill_number, payload?.shipment?.tracking_number, payload?.shipment?.trackingNumber, payload?.shipment?.awb);
}

function mapStatus(payload: any) {
  const raw = firstString(payload?.status, payload?.status_code, payload?.shipment_status, payload?.shipment?.status, payload?.shipment?.status_code)?.toUpperCase().replace(/[\s-]+/g, "_");
  if (!raw) return null;
  if (raw.includes("DELIVER")) return "DELIVERED";
  if (raw.includes("OUT_FOR_DELIVERY")) return "OUT_FOR_DELIVERY";
  if (raw.includes("TRANSIT") || raw.includes("PICKED_UP") || raw.includes("DISPATCH")) return "IN_TRANSIT";
  if (raw.includes("CANCEL") || raw.includes("RETURN")) return "CANCELLED";
  return null;
}

export async function POST(request: NextRequest, { params }: { params: { carrier_code: string } }) {
  const rate = checkRateLimit(request, "carrier-webhook", 300, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429 });
  const carrierCode = params.carrier_code.trim().toUpperCase();
  if (!isCarrierCode(carrierCode)) return NextResponse.json({ error: "Unknown carrier." }, { status: 404 });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 256_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
  try {
    const rawBody = await request.text();
    if (rawBody.length > 256_000) return NextResponse.json({ error: "Payload too large." }, { status: 413 });
    const payload = JSON.parse(rawBody);
    const awb = trackingNumber(payload);
    const status = mapStatus(payload);
    if (!awb || !status) return NextResponse.json({ error: "A tracking number and supported status are required." }, { status: 400 });

    const admin = createAdminClient();
    const { data: candidates, error: carriersError } = await (admin.from("carriers") as any)
      .select("id, encrypted_credentials").eq("carrier_code", carrierCode).eq("is_active", true);
    if (carriersError) throw carriersError;
    const signature = request.headers.get("x-proconnect-webhook-signature") ?? request.headers.get("x-webhook-signature");
    const carrier = (candidates ?? []).find((candidate: any) => {
      try { return verifiedSignature(rawBody, signature, decryptCredentials(candidate.encrypted_credentials).webhookSecret); }
      catch { return false; }
    });
    // Do not reveal whether a carrier or AWB exists to an unverified caller.
    if (!carrier) return NextResponse.json({ error: "Webhook signature is invalid." }, { status: 401 });

    const { data: shipment, error: shipmentError } = await (admin.from("carrier_shipments") as any)
      .select("id, sales_order_id, organization_id").eq("carrier_id", carrier.id).eq("tracking_number", awb).maybeSingle();
    if (shipmentError) throw shipmentError;
    if (!shipment) return NextResponse.json({ ok: true });
    const { error: updateShipmentError } = await (admin.from("carrier_shipments") as any)
      .update({ status, provider_status: status, last_webhook_at: new Date().toISOString(), updated_by: null })
      .eq("id", shipment.id).eq("organization_id", shipment.organization_id);
    if (updateShipmentError) throw updateShipmentError;
    const { error: updateOrderError } = await (admin.from("sales_orders") as any)
      .update({ carrier_status: status, updated_by: null }).eq("id", shipment.sales_order_id).eq("org_id", shipment.organization_id);
    if (updateOrderError) throw updateOrderError;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to process carrier webhook." }, { status: 400 });
  }
}
