import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { LocationManager } from "@/components/LocationManager";

const PAGE_SIZE = 50;

type Warehouse = { id: string; code: string; name: string };
type Zone = { id: string; warehouse_id: string; zone_code: string; zone_type: string; description?: string | null };
type Location = {
  id: string;
  zone_id: string;
  display_code?: string;
  location_code: string;
  aisle?: string | null;
  rack?: string | null;
  shelf?: string | null;
  bin?: string | null;
  is_active: boolean;
};

export default async function LocationsPage({ searchParams }: { searchParams?: { page?: string } }) {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;

  const supabase = createClient();
  const page = Math.max(1, Number.parseInt(searchParams?.page ?? "1", 10) || 1);
  const from = (page - 1) * PAGE_SIZE;

  // The prior nested select returned every bin in every zone. Warehouses are
  // lightweight, while bins are now page-limited before reaching the browser.
  const { data: warehouseData, error: warehouseError } = await supabase
    .from("warehouses")
    .select("id, code, name")
    .eq("org_id", ctx.org.id)
    .order("code");
  if (warehouseError) throw warehouseError;

  const warehouses = (warehouseData ?? []) as Warehouse[];
  const warehouseIds = warehouses.map((warehouse) => warehouse.id);
  if (!warehouseIds.length) {
    return (
      <div>
        <PageHeader title="Locations" subtitle="Warehouse, zone and bin hierarchy" />
        <div className="p-8">
          <LocationManager orgId={ctx.org.id} canManage={ctx.role === "owner" || ctx.role === "manager"} warehouses={[]} page={page} total={0} />
          <div className="bg-panel border border-line px-5 py-10 text-center text-graphite text-sm">
            No warehouses yet. Use <span className="font-medium text-ink">Add warehouse</span> to start building the location hierarchy.
          </div>
        </div>
      </div>
    );
  }

  const { data: zoneData, error: zoneError } = await supabase
    .from("warehouse_zones")
    .select("id, warehouse_id, zone_code, zone_type, description")
    .in("warehouse_id", warehouseIds)
    .order("zone_code");
  if (zoneError) throw zoneError;
  const zoneIds = (zoneData ?? []).map((zone: Zone) => zone.id);
  const { data: locationData, count, error: locationError } = zoneIds.length
    ? await supabase
      .from("locations")
      .select("id, zone_id, display_code, location_code, aisle, rack, shelf, bin, is_active", { count: "exact" })
      .in("zone_id", zoneIds)
      .order("location_code")
      .range(from, from + PAGE_SIZE - 1)
    : { data: [], count: 0, error: null };
  if (locationError) throw locationError;

  const locationsByZone = new Map<string, Location[]>();
  for (const location of (locationData ?? []) as Location[]) {
    const entries = locationsByZone.get(location.zone_id) ?? [];
    entries.push(location);
    locationsByZone.set(location.zone_id, entries);
  }
  const zonesByWarehouse = new Map<string, Zone[]>();
  for (const zone of (zoneData ?? []) as Zone[]) {
    const entries = zonesByWarehouse.get(zone.warehouse_id) ?? [];
    entries.push(zone);
    zonesByWarehouse.set(zone.warehouse_id, entries);
  }

  const hierarchy = warehouses.map((warehouse) => ({
    ...warehouse,
    warehouse_zones: (zonesByWarehouse.get(warehouse.id) ?? []).map((zone) => ({
      ...zone,
      locations: locationsByZone.get(zone.id) ?? [],
    })),
  }));

  return (
    <div>
      <PageHeader title="Locations" subtitle="Warehouse, zone and bin hierarchy" />
      <div className="p-8">
        <LocationManager
          orgId={ctx.org.id}
          canManage={ctx.role === "owner" || ctx.role === "manager"}
          warehouses={hierarchy}
          page={page}
          total={count ?? 0}
        />
      </div>
    </div>
  );
}
