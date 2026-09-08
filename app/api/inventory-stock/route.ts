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
    supabase.from("products").select("id").eq("id", productId).eq("org_id", orgId).maybeSingle(),
  ]);
  if (!membership || !product) return NextResponse.json({ error: "Inventory item was not found." }, { status: 404 });

  const { data, count, error } = await supabase
    .from("inventory_balances")
    .select("quantity_on_hand, quantity_reserved, locations(location_code, display_code)", { count: "exact" })
    .eq("product_id", productId)
    .or("quantity_on_hand.neq.0,quantity_reserved.neq.0")
    .order("updated_at", { ascending: false })
    .limit(PAGE_SIZE);
  if (error) return NextResponse.json({ error: "Unable to load stock details." }, { status: 500 });

  return NextResponse.json({
    stock: (data ?? []).map((balance: any) => ({
      locationCode: balance.locations?.display_code ?? balance.locations?.location_code ?? "Unknown bin",
      onHand: balance.quantity_on_hand,
      reserved: balance.quantity_reserved,
    })),
    total: count ?? 0,
  });
}
