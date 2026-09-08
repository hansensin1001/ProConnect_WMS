import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSafeText, isUuid } from "@/lib/validation";

const MAX_RESULTS = 50;

// Loaded only when a stock-adjustment drawer opens. This prevents Inventory
// from transferring every bin in a large warehouse on every route change.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId");
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 60).replace(/[,%()]/g, "");
  if (!isUuid(orgId) || (query && !isSafeText(query, 60))) return NextResponse.json({ error: "Invalid location search." }, { status: 400 });
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  const { data: membership } = await supabase.from("org_members").select("role").eq("org_id", orgId).eq("user_id", user.id).maybeSingle();
  if (!membership || !["owner", "manager"].includes((membership as { role: string }).role)) return NextResponse.json({ error: "Manager or owner access is required." }, { status: 403 });
  const { data: warehouses, error: warehouseError } = await supabase.from("warehouses").select("id").eq("org_id", orgId);
  if (warehouseError) return NextResponse.json({ error: "Unable to load locations." }, { status: 500 });
  const warehouseIds = (warehouses ?? []).map((warehouse: { id: string }) => warehouse.id);
  if (!warehouseIds.length) return NextResponse.json({ locations: [] });
  const { data: zones, error: zoneError } = await supabase.from("warehouse_zones").select("id").in("warehouse_id", warehouseIds);
  if (zoneError) return NextResponse.json({ error: "Unable to load locations." }, { status: 500 });
  const zoneIds = (zones ?? []).map((zone: { id: string }) => zone.id);
  if (!zoneIds.length) return NextResponse.json({ locations: [] });
  let locationsQuery = (supabase.from("locations") as any).select("id, display_code, location_code").in("zone_id", zoneIds).eq("is_active", true).order("location_code").limit(MAX_RESULTS);
  if (query) locationsQuery = locationsQuery.or(`location_code.ilike.%${query}%,display_code.ilike.%${query}%`);
  const { data, error } = await locationsQuery;
  if (error) return NextResponse.json({ error: "Unable to load locations." }, { status: 500 });
  return NextResponse.json({ locations: data ?? [] });
}
