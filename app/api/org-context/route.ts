import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validation";

export async function POST(request: NextRequest) {
  const rate = checkRateLimit(request, "org-context", 30, 60_000);
  if (!rate.allowed) return NextResponse.json({ error: "Too many organization changes. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfter) } });
  try {
    const body = await request.json();
    if (!isUuid(body?.orgId)) return NextResponse.json({ error: "Invalid organization." }, { status: 400 });
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data, error } = await supabase.from("org_members").select("org_id").eq("user_id", user.id).eq("org_id", body.orgId).maybeSingle();
    if (error) throw error;
    if (!data) return NextResponse.json({ error: "Organization access denied" }, { status: 403 });
    const response = NextResponse.json({ ok: true });
    response.cookies.set("proconnect-org-id", body.orgId, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
    return response;
  } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
}
