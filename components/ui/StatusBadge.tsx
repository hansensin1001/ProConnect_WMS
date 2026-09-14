const neutral = "bg-slate-100 text-slate-700 ring-slate-300";
const pending = "bg-amber-50 text-amber-900 ring-amber-300";
const good = "bg-emerald-50 text-emerald-800 ring-emerald-300";
const blocked = "bg-red-50 text-red-800 ring-red-300";
const moving = "bg-blue-50 text-blue-800 ring-blue-300";
const colors: Record<string, string> = {
  DRAFT: neutral, NEW: moving, PENDING: pending, ALLOCATED: "bg-violet-50 text-violet-800 ring-violet-300",
  UNDER_ALLOCATION: pending, PICKING: pending, PACKED: moving, PROCESSING: pending,
  PARTIALLY_RECEIVED: pending, PARTIALLY_SHIPPED: pending, BACKORDERED: pending,
  PENDING_APPROVAL: pending, RTV_PENDING: pending, INBOUND: moving, OUTBOUND: moving,
  RECEIVED: good, COMPLETED: good, SHIPPED: good, DELIVERED: good, APPROVED: good, ACTIVE: good, IN_STOCK: good,
  INACTIVE: neutral, CANCELLED: neutral, REVERTED: neutral, ADJUSTMENT: neutral,
  QUARANTINE: blocked, QUARANTINED: blocked, REPAIR: pending, REJECTED: blocked, LOW: blocked, VOIDED: neutral,
};
export function StatusBadge({ status }: { status?: string | null }) {
  const value = status?.trim().toUpperCase() || "NOT SET";
  return <span className={`inline-flex max-w-full items-center rounded-full px-2.5 py-1 text-[11px] font-semibold tracking-wide ring-1 ring-inset ${colors[value] ?? neutral}`}>{value.replace(/_/g, " ")}</span>;
}
