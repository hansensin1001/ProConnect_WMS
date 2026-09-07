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
        {(warehouses ?? []).map((w: any) => (
          <div key={w.id} className="bg-panel border border-line">
            <div className="px-5 py-3 border-b border-line flex items-baseline gap-2">
              <span className="code-label text-xs text-graphite">{w.code}</span>
              <span className="font-medium">{w.name}</span>
            </div>
            <div className="p-5 space-y-4">
              {(w.warehouse_zones ?? []).map((z: any) => (
                <div key={z.id}>
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs px-2 py-0.5 bg-rack/10 text-rack border border-rack/30 code-label">
                      {z.zone_code}
                    </span>
                    <span className="text-xs text-graphite">{z.zone_type}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(z.locations ?? []).map((loc: any) => (
                      <div
                        key={loc.id}
                        className={`code-label text-xs px-2.5 py-1.5 border ${
                          loc.is_active
                            ? "border-line bg-paper text-ink"
                            : "border-line bg-paper text-graphite/50 line-through"
                        }`}
                      >
                        <span>{loc.display_code ?? "LOC?"}</span><span className="ml-1 text-graphite">· {loc.location_code}</span>
                      </div>
                    ))}
                    {(z.locations ?? []).length === 0 && (
                      <span className="text-xs text-graphite">No bins mapped yet.</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}

        {(warehouses ?? []).length === 0 && (
          <div className="bg-panel border border-line px-5 py-10 text-center text-graphite text-sm">
            No warehouses yet. Add a row to the{" "}
            <span className="code-label">warehouses</span> table to get started.
          </div>
        )}
      </div>
    </div>
  );
}
