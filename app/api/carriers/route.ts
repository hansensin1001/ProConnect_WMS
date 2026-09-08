import { NextRequest, NextResponse } from "next/server";
import { decryptCredentials, encryptCredentials } from "@/lib/carriers/crypto";
import { carrierDisplayName, isCarrierCode, type CarrierCredentials } from "@/lib/carriers/types";
import { checkRateLimit } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isSafeText, isUuid } from "@/lib/validation";

export const runtime = "nodejs";

async function requireCarrierManager(orgId: string) {
  const auth = createClient();
  const { data: { user }, error: authError } = await auth.auth.getUser();
  if (authError || !user) throw new Error("Sign in again to continue.");
  const { data: member, error: memberError } = await auth.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (memberError) throw memberError;
  if (!member || !["owner", "manager"].includes((member as { role: string }).role)) throw new Error("Manager or owner access is required.");
  return { user, admin: createAdminClient() };
}

function safeCarrier(row: any) {
  return {
    id: row.id,
    organization_id: row.organization_id,
    carrier_code: row.carrier_code,
    display_name: row.display_name,
    is_active: row.is_active,
    is_sandbox: row.is_sandbox,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function credentialsFrom(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const credentials: CarrierCredentials = {};
  for (const key of ["apiKey", "apiSecret", "accountNumber", "clientId", "webhookSecret"] as const) {
    const field = input[key];
    if (field == null || field === "") continue;
    if (!isSafeText(field, 4_000, true)) throw new Error("Carrier credentials contain an invalid value.");
    credentials[key] = field.trim();
  }
  return Object.keys(credentials).length ? credentials : undefined;
}

function failure(error: unknown, status = 400) {
  const message = error instanceof Error ? error.message : "Unable to manage carrier settings.";
  const safe = ["Sign in again to continue.", "Manager or owner access is required.", "Invalid", "Carrier credential", "Select a supported", "Provide a display", "Carrier not found", "Carrier integration is not configured", "Carrier credential encryption is not configured", "CARRIER_CREDENTIALS_ENCRYPTION_KEY"].some((prefix) => message.startsWith(prefix));
  return NextResponse.json({ error: safe ? message : "Unable to manage carrier settings." }, { status });
}

export async function GET(request: NextRequest) {
  const rate = checkRateLimit(request, "carrier-settings-read", 120, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many requests. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const orgId = new URL(request.url).searchParams.get("orgId");
    if (!isUuid(orgId)) throw new Error("Invalid organization.");
    const { admin } = await requireCarrierManager(orgId);
    const { data, error } = await (admin.from("carriers") as any)
      .select("id, organization_id, carrier_code, display_name, is_active, is_sandbox, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("display_name");
    if (error) throw error;
    return NextResponse.json({ carriers: (data ?? []).map(safeCarrier) });
  } catch (error) { return failure(error, 403); }
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "carrier-settings-write", 30, 10 * 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many carrier-setting changes. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(body?.orgId) || !isCarrierCode(body?.carrierCode)) throw new Error("Select a supported carrier and organization.");
    const displayName = String(body.displayName ?? "").trim();
    if (!isSafeText(displayName, 100, true)) throw new Error("Provide a display name for this carrier.");
    if (typeof body.isActive !== "boolean" || typeof body.isSandbox !== "boolean") throw new Error("Invalid carrier settings.");
    if (body.id != null && !isUuid(body.id)) throw new Error("Invalid carrier.");
    const credentials = credentialsFrom(body.credentials);
    const { user, admin } = await requireCarrierManager(body.orgId);

    if (body.id) {
      const { data: existing, error: readError } = await (admin.from("carriers") as any).select("id, encrypted_credentials").eq("id", body.id).eq("organization_id", body.orgId).maybeSingle();
      if (readError) throw readError;
      if (!existing) throw new Error("Carrier not found in the active organization.");
      const encryptedCredentials = credentials ? encryptCredentials({ ...decryptCredentials(existing.encrypted_credentials), ...credentials }) : undefined;
      const { data, error } = await (admin.from("carriers") as any)
        .update({ carrier_code: body.carrierCode, display_name: displayName, is_active: body.isActive, is_sandbox: body.isSandbox, ...(encryptedCredentials ? { encrypted_credentials: encryptedCredentials } : {}), updated_by: user.id })
        .eq("id", body.id).eq("organization_id", body.orgId)
        .select("id, organization_id, carrier_code, display_name, is_active, is_sandbox, created_at, updated_at").single();
      if (error) throw error;
      return NextResponse.json({ carrier: safeCarrier(data) });
    }

    const { data, error } = await (admin.from("carriers") as any)
      .insert({ organization_id: body.orgId, carrier_code: body.carrierCode, display_name: displayName || carrierDisplayName(body.carrierCode), is_active: body.isActive, is_sandbox: body.isSandbox, encrypted_credentials: encryptCredentials(credentials ?? {}), created_by: user.id, updated_by: user.id })
      .select("id, organization_id, carrier_code, display_name, is_active, is_sandbox, created_at, updated_at").single();
    if (error) throw error;
    return NextResponse.json({ carrier: safeCarrier(data) });
  } catch (error) { return failure(error); }
}
