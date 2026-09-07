import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerAuthClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmail, isRole, isSafeText, isSlug, isStrongTemporaryPassword, isUuid } from "@/lib/validation";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Admin provisioning is not configured. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function requirePlatformAdmin() {
  const authClient = createServerAuthClient();
  const { data: userResult, error: userError } = await authClient.auth.getUser();
  if (userError || !userResult.user) throw new Error("Sign in again to continue.");
  const supabase = serviceClient();
  const { data: admin } = await supabase.from("platform_admins").select("user_id").eq("user_id", userResult.user.id).maybeSingle();
  if (!admin) throw new Error("Platform administrator access is required.");
  return { supabase, user: userResult.user };
}

function failure(error: unknown, status = 400) {
  return NextResponse.json({ error: error instanceof Error ? error.message : "Request failed." }, { status });
}

export async function GET(request: NextRequest) {
  try {
    const rate = checkRateLimit(request, "admin-read", 120, 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const { supabase } = await requirePlatformAdmin();
    const { data, error } = await supabase.from("organizations").select("id, code, name, slug, deployment_mode, created_at, org_members(id, user_id, role, created_at)").order("code");
    if (error) throw error;
    const { data: profiles, error: profileError } = await supabase.from("user_profiles").select("user_id, user_code, email, is_disabled");
    if (profileError) throw profileError;
    const usersById = new Map((profiles ?? []).map((profile) => [profile.user_id, { email: profile.email ?? "Unknown user", disabled: profile.is_disabled, user_code: profile.user_code }]));
    const organizations = (data ?? []).map((organization: any) => ({ ...organization, org_members: organization.org_members.map((member: any) => ({ ...member, ...usersById.get(member.user_id) })) }));
    return NextResponse.json({ organizations });
  } catch (error) { return failure(error, 403); }
}

export async function POST(request: NextRequest) {
  try {
    const rate = checkRateLimit(request, "admin-create", 10, 10 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many provisioning requests. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const { supabase } = await requirePlatformAdmin();
    const body = await request.json();
    if (body.kind === "organization") {
      const name = String(body.name ?? "").trim();
      const slug = String(body.slug ?? "").trim().toLowerCase();
      if (!isSafeText(name, 150, true) || !isSlug(slug) || slug.length > 150) throw new Error("Provide an organization name and a lowercase hyphenated slug.");
      const { data, error } = await supabase.from("organizations").insert({ name, slug, deployment_mode: body.deploymentMode === "client_managed" ? "client_managed" : "managed" }).select("id, code, name, slug, deployment_mode, created_at").single();
      if (error) throw error;
      return NextResponse.json({ organization: data });
    }
    if (body.kind === "user") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = body.password;
      const orgId = body.orgId;
      const role = isRole(body.role) ? body.role : "operator";
      if (!isEmail(email) || !isStrongTemporaryPassword(password) || !isUuid(orgId)) throw new Error("Use a valid email, a 12+ character password with letters and numbers, and a valid organization.");
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
    const rate = checkRateLimit(request, "admin-change", 30, 10 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many administrative changes. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const { supabase } = await requirePlatformAdmin();
    const body = await request.json();
    if (body.kind === "password") {
      const password = body.password;
      if (!isUuid(body.userId) || !isStrongTemporaryPassword(password)) throw new Error("A valid user and a 12+ character temporary password with letters and numbers are required.");
      const { error } = await supabase.auth.admin.updateUserById(body.userId, { password });
      if (error) throw error;
      return NextResponse.json({ ok: true });
    }
    if (body.kind === "disable") {
      if (!isUuid(body.userId) || typeof body.disabled !== "boolean") throw new Error("A valid user and account state are required.");
      const { error } = await supabase.auth.admin.updateUserById(body.userId, { ban_duration: body.disabled ? "876000h" : "none" });
      if (error) throw error;
      const { error: profileError } = await supabase.from("user_profiles").update({ is_disabled: body.disabled }).eq("user_id", body.userId);
      if (profileError) throw profileError;
      return NextResponse.json({ ok: true });
    }
    const role = isRole(body.role) ? body.role : null;
    if (!isUuid(body.memberId) || !role) throw new Error("Member and valid role are required.");
    const { error } = await supabase.from("org_members").update({ role }).eq("id", body.memberId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error, 403); }
}

export async function DELETE(request: NextRequest) {
  try {
    const rate = checkRateLimit(request, "admin-delete", 20, 10 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many administrative changes. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const { supabase } = await requirePlatformAdmin();
    const memberId = new URL(request.url).searchParams.get("memberId");
    if (!isUuid(memberId)) throw new Error("A valid member is required.");
    const { error } = await supabase.from("org_members").delete().eq("id", memberId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (error) { return failure(error, 403); }
}
