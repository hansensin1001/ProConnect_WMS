import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgContext } from "@/lib/org";
import { PageHeader } from "@/components/PageHeader";
import { ScanConsole } from "@/components/ScanConsole";

export default async function ScanPage() {
  const ctx = await getCurrentOrgContext();
  if (!ctx?.org) return null;
  const supabase = createClient();

  const { data } = await supabase
    .from("warehouses")
    .select("id, code, name")
    .eq("org_id", ctx.org.id)
    .order("code")
    .limit(1);

  const warehouses = (data ?? []) as { id: string; code: string; name: string }[];
  const warehouse = warehouses[0];

  return (
    <div>
      <PageHeader
        title="Scan"
        subtitle="Put-away and pick, using the device camera as a barcode scanner"
      />
      <div className="p-8">
        {warehouse ? (
          <ScanConsole orgId={ctx.org.id} warehouseId={warehouse.id} />
        ) : (
          <div className="bg-panel border border-line px-5 py-10 text-center text-graphite text-sm">
            No warehouse set up yet for this organization.
          </div>
        )}
      </div>
    </div>
  );
}
