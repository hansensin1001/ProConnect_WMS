import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeText, isUuid } from "@/lib/validation";

function optionalUuid(value: string | null) {
  return value && isUuid(value) ? value : null;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const orgId = params.get("orgId");
    if (!isUuid(orgId)) return NextResponse.json({ error: "Invalid organization." }, { status: 400 });
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { data: member, error: membershipError } = await supabase.from("org_members").select("org_id").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
    if (membershipError) throw membershipError;
    if (!member) return NextResponse.json({ error: "Organization access is required." }, { status: 403 });

    const search = (params.get("q") ?? "").trim().slice(0, 80);
    if (search && !isSafeText(search, 80)) return NextResponse.json({ error: "Invalid report search." }, { status: 400 });
    const rawFrom = params.get("from"); const rawTo = params.get("to");
    const from = rawFrom && !Number.isNaN(Date.parse(rawFrom)) ? new Date(rawFrom).toISOString() : null;
    const to = rawTo && !Number.isNaN(Date.parse(rawTo)) ? new Date(rawTo).toISOString() : null;
    const limit = Math.min(200, Math.max(1, Number.parseInt(params.get("limit") ?? "100", 10) || 100));
    const offset = Math.max(0, Number.parseInt(params.get("offset") ?? "0", 10) || 0);
    const eventType = (params.get("eventType") ?? "ALL").toUpperCase();
    if (!["ALL", "INVENTORY", "PO_REJECTED", "RMA", "RTV", "CYCLE_COUNT"].includes(eventType)) return NextResponse.json({ error: "Invalid event type." }, { status: 400 });

    const { data, error } = await (supabase.rpc as any)("get_traceability_report", {
      p_org_id: orgId, p_from: from, p_to: to,
      p_warehouse_id: optionalUuid(params.get("warehouseId")), p_zone_id: optionalUuid(params.get("zoneId")), p_location_id: optionalUuid(params.get("locationId")),
      p_search: search || null, p_event_type: eventType, p_limit: limit, p_offset: offset,
    });
    if (error) throw error;
    return NextResponse.json({ rows: data ?? [], nextOffset: (data ?? []).length === limit ? offset + limit : null });
  } catch (error) {
    return NextResponse.json({ error: "Unable to load the traceability report." }, { status: 500 });
  }
}
