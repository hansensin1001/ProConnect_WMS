export function StatusBadge({ status }: { status: string }) {
  const color: Record<string, string> = {
    NEW: "bg-blue-50 text-blue-700 ring-blue-200", ALLOCATED: "bg-violet-50 text-violet-700 ring-violet-200",
    PICKING: "bg-amber-50 text-amber-dark ring-amber-200", PACKED: "bg-orange-50 text-orange-700 ring-orange-200",
    SHIPPED: "bg-emerald-50 text-go ring-emerald-200", ACTIVE: "bg-emerald-50 text-go ring-emerald-200",
    INACTIVE: "bg-slate-100 text-graphite ring-slate-200", LOW: "bg-red-50 text-alert ring-red-200",
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${color[status] ?? "bg-slate-100 text-graphite ring-slate-200"}`}>{status.replace("_", " ")}</span>;
}
