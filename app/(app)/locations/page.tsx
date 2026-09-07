import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { LocationManager } from "@/components/LocationManager";

export default async function LocationsPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const { data: warehouses } = await supabase
    .from("warehouses")
    .select(
      "id, code, name, warehouse_zones(id, zone_code, zone_type, locations(id, display_code, location_code, is_active))"
    )
    .eq("org_id", ctx.org.id);

  return (
    <div>
      <PageHeader title="Locations" subtitle="Warehouse, zone and bin hierarchy" />

      <div className="p-8 space-y-6">
        <LocationManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} warehouses={(warehouses ?? []) as any[]} />
        {(warehouses ?? []).length === 0 && (
          <div className="bg-panel border border-line px-5 py-10 text-center text-graphite text-sm">
            No warehouses yet. Use <span className="font-medium text-ink">Add warehouse</span> to start building the location hierarchy.
          </div>
        )}
      </div>
    </div>
  );
}
