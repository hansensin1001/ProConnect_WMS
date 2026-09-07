import { NextRequest, NextResponse } from "next/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { validateLoginInput } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isEmail } from "@/lib/validation";

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  return createServiceClient(url, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "login", 10, 15 * 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many sign-in attempts. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });

  const body = await request.json().catch(() => null);
  const input = validateLoginInput(body);
  if (!input.valid) return NextResponse.json({ error: input.error }, { status: 400 });

  try {
    let email = input.value.identifier;
    if (!isEmail(email)) {
      const service = serviceClient();
      if (!service) return NextResponse.json({ error: "User ID sign-in is not configured. Use your email temporarily or configure the server key." }, { status: 503 });
      const { data: profile, error } = await service.from("user_profiles").select("email, is_disabled").eq("username", email).maybeSingle();
      if (error || !profile || profile.is_disabled || !profile.email) return NextResponse.json({ error: "Invalid User ID or password." }, { status: 401 });
      email = profile.email;
    }

    const supabase = createServerClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password: input.value.password });
    if (error) return NextResponse.json({ error: "Invalid User ID or password." }, { status: 401 });
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch {
    // Do not disclose provider, database, or account-existence details.
    return NextResponse.json({ error: "Unable to sign in right now. Try again shortly." }, { status: 503 });
  }
}
