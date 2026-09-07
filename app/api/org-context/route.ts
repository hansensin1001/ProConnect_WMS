import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const { orgId } = await request.json();
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { data } = await supabase.from("org_members").select("org_id").eq("user_id", user.id).eq("org_id", orgId).maybeSingle();
  if (!data) return NextResponse.json({ error: "Organization access denied" }, { status: 403 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("proconnect-org-id", orgId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 30 });
  return response;
}
