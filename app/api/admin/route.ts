import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerAuthClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmail, isRole, isSafeText, isSlug, isStrongTemporaryPassword, isUsername, isUuid } from "@/lib/validation";

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
    const { data: profiles, error: profileError } = await supabase.from("user_profiles").select("user_id, user_code, username, display_name, email, is_disabled");
    if (profileError) throw profileError;
    const usersById = new Map((profiles ?? []).map((profile: any) => [profile.user_id, { email: profile.email ?? "Unknown user", disabled: profile.is_disabled, user_code: profile.user_code, username: profile.username, display_name: profile.display_name }]));
    const organizations = (data ?? []).map((organization: any) => ({ ...organization, org_members: organization.org_members.map((member: any) => ({ ...member, ...usersById.get(member.user_id) })) }));
    const users = (profiles ?? []).map((profile: any) => ({ ...profile, memberships: organizations.flatMap((organization: any) => organization.org_members.filter((member: any) => member.user_id === profile.user_id).map((member: any) => ({ ...member, organization: { id: organization.id, code: organization.code, name: organization.name } }))) }));
    return NextResponse.json({ organizations, users });
  } catch (error) { return failure(error, 403); }
}

export async function POST(request: NextRequest) {
  try {
    const rate = checkRateLimit(request, "admin-create", 10, 10 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many provisioning requests. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const { supabase, user } = await requirePlatformAdmin();
    const body = await request.json();
    if (body.kind === "organization") {
      const name = String(body.name ?? "").trim();
      const slug = String(body.slug ?? "").trim().toLowerCase();
      if (!isSafeText(name, 150, true) || !isSlug(slug) || slug.length > 150) throw new Error("Provide an organization name and a lowercase hyphenated slug.");
      const { data, error } = await supabase.from("organizations").insert({ name, slug, deployment_mode: body.deploymentMode === "client_managed" ? "client_managed" : "managed", created_by: user.id, updated_by: user.id }).select("id, code, name, slug, deployment_mode, created_at").single();
      if (error) throw error;
      return NextResponse.json({ organization: data });
    }
    if (body.kind === "user") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const username = String(body.username ?? "").trim().toLowerCase();
      const displayName = String(body.displayName ?? "").trim();
      const password = body.password;
      const orgId = body.orgId;
      const role = isRole(body.role) ? body.role : "operator";
      if (!isEmail(email) || !isUsername(username) || !isSafeText(displayName, 150, true) || !isStrongTemporaryPassword(password) || !isUuid(orgId)) throw new Error("Provide a User ID, display name, valid email, 12+ character password, and organization.");
      const { data: existing } = await supabase.from("user_profiles").select("user_id").eq("username", username).maybeSingle();
      if (existing) throw new Error("That User ID is already in use.");
      const { data: created, error: createError } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { name: displayName } });
      if (createError || !created.user) throw createError ?? new Error("Unable to create user.");
      const { error: profileError } = await supabase.from("user_profiles").update({ username, display_name: displayName, updated_by: user.id }).eq("user_id", created.user.id);
      if (profileError) { await supabase.auth.admin.deleteUser(created.user.id); throw profileError; }
      const { error: memberError } = await supabase.from("org_members").insert({ org_id: orgId, user_id: created.user.id, role, created_by: user.id, updated_by: user.id });
      if (memberError) {
        await supabase.auth.admin.deleteUser(created.user.id);
        throw memberError;
      }
      return NextResponse.json({ user: { id: created.user.id, username, email: created.user.email, role, orgId } });
    }
    throw new Error("Unknown create request.");
  } catch (error) { return failure(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    const rate = checkRateLimit(request, "admin-change", 30, 10 * 60_000);
    if (!rate.allowed) return NextResponse.json({ error: "Too many administrative changes. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
    const { supabase, user } = await requirePlatformAdmin();
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
      const { error: profileError } = await supabase.from("user_profiles").update({ is_disabled: body.disabled, updated_by: user.id }).eq("user_id", body.userId);
      if (profileError) throw profileError;
      return NextResponse.json({ ok: true });
    }
    if (body.kind === "user") {
      const userId = body.userId;
      const username = String(body.username ?? "").trim().toLowerCase();
      const displayName = String(body.displayName ?? "").trim();
      const assignments = Array.isArray(body.assignments) ? body.assignments : [];
      if (!isUuid(userId) || !isUsername(username) || !isSafeText(displayName, 150, true) || !assignments.length || !assignments.every((assignment: any) => isUuid(assignment?.orgId) && isRole(assignment?.role))) throw new Error("User details and at least one valid organization assignment are required.");
      const { data: duplicate } = await supabase.from("user_profiles").select("user_id").eq("username", username).neq("user_id", userId).maybeSingle();
      if (duplicate) throw new Error("That User ID is already in use.");
      const { error: profileError } = await supabase.from("user_profiles").update({ username, display_name: displayName, updated_by: user.id }).eq("user_id", userId);
      if (profileError) throw profileError;
      const { error: clearError } = await supabase.from("org_members").delete().eq("user_id", userId);
      if (clearError) throw clearError;
      const { error: membershipError } = await supabase.from("org_members").insert(assignments.map((assignment: any) => ({ org_id: assignment.orgId, user_id: userId, role: assignment.role, created_by: user.id, updated_by: user.id })));
      if (membershipError) throw membershipError;
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
