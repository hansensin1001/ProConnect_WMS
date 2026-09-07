import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isSafeText, isUsername } from "@/lib/validation";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Authentication is not configured.");
  return createServiceClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "login", 10, 15 * 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = body?.password;
    if (!isUsername(username) || !isSafeText(password, 128, true)) throw new Error("Invalid credentials.");
    const service = serviceClient();
    const { data: profile, error: profileError } = await service.from("user_profiles").select("email, is_disabled").eq("username", username).maybeSingle();
    if (profileError || !profile || profile.is_disabled || !profile.email) throw new Error("Invalid credentials.");
    const auth = createServerClient();
    const { error } = await auth.auth.signInWithPassword({ email: profile.email, password });
    if (error) throw new Error("Invalid credentials.");
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error && error.message === "Authentication is not configured." ? error.message : "Invalid User ID or password.";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}
