import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/validation";

const PAGE_SIZE = 100;
// Bin details are deliberately loaded only after a user opens SKU details.
// The Inventory list itself stays compact regardless of warehouse size.
export async function GET(request: NextRequest) {
  const orgId = request.nextUrl.searchParams.get("orgId");
  const productId = request.nextUrl.searchParams.get("productId");
  if (!isUuid(orgId) || !isUuid(productId)) {
    return NextResponse.json({ error: "Invalid inventory request." }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const [{ data: membership }, { data: product }] = await Promise.all([
    supabase.from("org_members").select("org_id").eq("org_id", orgId).eq("user_id", user.id).maybeSingle(),
    supabase.from("products").select("id, is_serialized").eq("id", productId).eq("org_id", orgId).maybeSingle(),
  ]);
  if (!membership || !product) return NextResponse.json({ error: "Inventory item was not found." }, { status: 404 });

  const { data: distribution, error: distributionError } = await (supabase.rpc as any)("get_inventory_location_distribution", { p_org_id: orgId, p_product_id: productId, p_limit: PAGE_SIZE });
  if (distributionError) return NextResponse.json({ error: "Unable to load the location distribution." }, { status: 500 });

  // Serial data is intentionally retrieved only for an opened serialized SKU.
  // Both predicates are retained here (as well as RLS) to preserve tenant isolation.
  let serials: Array<{ serialNumber: string; locationCode: string }> = [];
  const serialsByLocation = new Map<string, string[]>();
  let serialTotal = 0;
  const isSerialized = Boolean((product as unknown as { is_serialized?: boolean }).is_serialized);
  if (isSerialized) {
    const { data: serialRows, count: serialCount, error: serialError } = await supabase
      .from("serial_numbers")
      .select("serial_number, location_id, locations(location_code, display_code)", { count: "exact" })
      .eq("org_id", orgId)
      .eq("product_id", productId)
      .eq("status", "IN_STOCK")
      .order("serial_number", { ascending: true })
      .limit(PAGE_SIZE);
    if (serialError) return NextResponse.json({ error: "Unable to load available serial numbers." }, { status: 500 });
    serials = (serialRows ?? []).map((serial: any) => ({
      serialNumber: serial.serial_number,
      locationCode: serial.locations?.display_code ?? serial.locations?.location_code ?? "Unknown bin",
    }));
    (serialRows ?? []).forEach((serial: any) => {
      const entries = serialsByLocation.get(serial.location_id) ?? [];
      entries.push(serial.serial_number);
      serialsByLocation.set(serial.location_id, entries);
    });
    serialTotal = serialCount ?? 0;
  }

  return NextResponse.json({
    stock: (distribution ?? []).map((location: any) => ({
      locationId: location.location_id,
      warehouseName: location.warehouse_name,
      zoneCode: location.zone_code,
      locationCode: location.location_code,
      onHand: Number(location.quantity_on_hand),
      reserved: Number(location.quantity_reserved),
      available: Number(location.quantity_available),
      inbound: Number(location.quantity_inbound),
      quarantined: Number(location.quantity_quarantined),
      serialNumbers: serialsByLocation.get(location.location_id) ?? [],
    })),
    total: distribution?.length ?? 0,
    serials,
    serialTotal,
  });
}
