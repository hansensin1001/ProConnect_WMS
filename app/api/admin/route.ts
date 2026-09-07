import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Admin provisioning is not configured. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requirePlatformAdmin(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Sign in again to continue.");
  const supabase = serviceClient();
  const { data: userResult, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userResult.user) throw new Error("Your session is invalid.");
  const { data: admin } = await supabase.from("platform_admins").select("user_id").eq("user_id", userResult.user.id).maybeSingle();
  if (!admin) throw new Error("Platform administrator access is required.");
  return { supabase, user: userResult.user };
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const { supabase } = await requirePlatformAdmin(request);
    const { data, error } = await supabase.from("organizations").select("id, name, slug, deployment_mode, created_at, org_members(id, user_id, role, created_at)").order("name");
    if (error) throw error;
    return NextResponse.json({ organizations: data ?? [] });
  } catch (error) { return failure(error, 403); }
}

export async function POST(request: NextRequest) {
  try {
    const { supabase } = await requirePlatformAdmin(request);
    const body = await request.json();
    if (body.kind === "organization") {
      const name = String(body.name ?? "").trim();
      const slug = String(body.slug ?? "").trim().toLowerCase();
      if (!name || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error("Provide an organization name and a lowercase hyphenated slug.");
      const { data, error } = await supabase.from("organizations").insert({ name, slug, deployment_mode: body.deploymentMode === "client_managed" ? "client_managed" : "managed" }).select("id, name, slug, deployment_mode, created_at").single();
      if (error) throw error;
      return NextResponse.json({ organization: data });
    }
    if (body.kind === "user") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const orgId = String(body.orgId ?? "");
      const role = ["owner", "manager", "operator"].includes(body.role) ? body.role : "operator";
      if (!email || password.length < 8 || !orgId) throw new Error("Email, an 8+ character password, and organization are required.");
      const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
      if (createError || !created.user) throw createError ?? new Error("Unable to create user.");
      const { error: memberError } = await supabase.from("org_members").insert({ org_id: orgId, user_id: created.user.id, role });
      if (memberError) {
        await supabase.auth.admin.deleteUser(created.user.id);
        throw memberError;
      }
      return NextResponse.json({ user: { id: created.user.id, email: created.user.email, role, orgId } });
    }
    throw new Error("Unknown create request.");
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const { supabase } = await requirePlatformAdmin(request);
    const body = await request.json();
    const role = ["owner", "manager", "operator"].includes(body.role) ? body.role : null;
    if (!body.memberId || !role) throw new Error("Member and valid role are required.");
    const { error } = await supabase.from("org_members").update({ role }).eq("id", body.memberId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error, 403); }
}

export async function DELETE(request: NextRequest) {
  try {
    const { supabase } = await requirePlatformAdmin(request);
    const memberId = new URL(request.url).searchParams.get("memberId");
    if (!memberId) throw new Error("Member is required.");
    const { error } = await supabase.from("org_members").delete().eq("id", memberId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error, 403); }
}
