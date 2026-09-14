"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  ArrowRight,
  Boxes,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FileDown,
  PackageCheck,
  ShieldAlert,
  Truck,
} from "lucide-react";
import { StatusBadge } from "@/components/ui/StatusBadge";

type Activity = {
  id: string;
  kind: "SALES" | "PURCHASE";
  reference: string;
  counterparty: string | null;
  status: string;
  createdAt: string;
  href: string;
};

type Metric = {
  label: string;
  value: number;
  helper: string;
  href: string;
  tone: "rack" | "amber" | "alert" | "violet";
  icon: typeof Boxes;
};

const toneClasses: Record<Metric["tone"], string> = {
  rack: "border-rack/20 bg-rack/5 text-rack",
  amber: "border-amber/30 bg-amber/10 text-amber-dark",
  alert: "border-alert/20 bg-alert/5 text-alert",
  violet: "border-violet-200 bg-violet-50 text-violet-700",
};

function formattedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(date);
}

export function DashboardOverview({
  organizationName,
  generatedAt,
  metrics,
  activity,
}: {
  organizationName: string;
  generatedAt: string;
  metrics: {
    skuCount: number;
    serializedSkuCount: number;
    allocatedOrders: number;
    openSalesOrders: number;
    openPurchaseOrders: number;
    lowStockBalances: number;
    quarantinedBalances: number;
  };
  activity: Activity[];
}) {
  const [activityFilter, setActivityFilter] = useState<"ALL" | Activity["kind"]>("ALL");
  const displayedActivity = useMemo(
    () => activity.filter((item) => activityFilter === "ALL" || item.kind === activityFilter),
    [activity, activityFilter],
  );
  const cards: Metric[] = [
    { label: "Master SKUs", value: metrics.skuCount, helper: `${metrics.serializedSkuCount} serialized`, href: "/inventory", tone: "rack", icon: Boxes },
    { label: "Ready to ship", value: metrics.allocatedOrders, helper: `${metrics.openSalesOrders} open sales orders`, href: "/orders?status=ALLOCATED", tone: "amber", icon: PackageCheck },
    { label: "Inbound to receive", value: metrics.openPurchaseOrders, helper: "Open purchase orders", href: "/purchase-orders?status=PENDING", tone: "violet", icon: Truck },
    { label: "Stock attention", value: metrics.lowStockBalances, helper: `${metrics.quarantinedBalances} quarantine locations`, href: "/inventory", tone: "alert", icon: CircleAlert },
  ];

  const priorityItems = [
    metrics.allocatedOrders > 0 ? { title: `${metrics.allocatedOrders} sales order${metrics.allocatedOrders === 1 ? "" : "s"} ready to ship`, detail: "Complete serial checks, create the AWB, and dispatch.", href: "/orders?status=ALLOCATED", icon: PackageCheck, tone: "amber" as const } : null,
    metrics.openPurchaseOrders > 0 ? { title: `${metrics.openPurchaseOrders} purchase order${metrics.openPurchaseOrders === 1 ? "" : "s"} awaiting receipt`, detail: "Receive stock or use Partial Receive for an incomplete delivery.", href: "/partial-receipts", icon: Truck, tone: "violet" as const } : null,
    metrics.lowStockBalances > 0 ? { title: `${metrics.lowStockBalances} location balance${metrics.lowStockBalances === 1 ? "" : "s"} below threshold`, detail: "Review available stock before accepting more sales orders.", href: "/inventory", icon: ShieldAlert, tone: "alert" as const } : null,
  ].filter(Boolean) as { title: string; detail: string; href: string; icon: typeof PackageCheck; tone: Metric["tone"] }[];

  return (
    <div className="space-y-6">
      <section className="overflow-hidden rounded-xl border border-ink bg-ink text-white shadow-sm">
        <div className="grid gap-6 px-6 py-6 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber">Operations command center</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Everything needing attention, in one place.</h2>
            <p className="mt-2 max-w-2xl text-sm text-white/65">Live view for {organizationName}. Prioritize dispatches, inbound receiving, and inventory risks before they affect customers.</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-white/70"><Clock3 size={15} /> Last refreshed</div>
            <p className="mt-1 font-medium text-white">{formattedTime(generatedAt)}</p>
          </div>
        </div>
        <div className="grid border-t border-white/10 sm:grid-cols-3">
          <Link href="/orders" className="group flex items-center justify-between gap-3 px-6 py-4 text-sm transition hover:bg-white/5"><span><span className="block font-medium">Sales orders</span><span className="mt-1 block text-xs text-white/55">Allocate, fulfil, and reprint AWBs</span></span><ArrowRight size={17} className="text-amber transition group-hover:translate-x-1" /></Link>
          <Link href="/purchase-orders" className="group flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4 text-sm transition hover:bg-white/5 sm:border-l sm:border-t-0"><span><span className="block font-medium">Purchase orders</span><span className="mt-1 block text-xs text-white/55">Receive goods into warehouse stock</span></span><ArrowRight size={17} className="text-amber transition group-hover:translate-x-1" /></Link>
          <Link href="/cycle-counts" className="group flex items-center justify-between gap-3 border-t border-white/10 px-6 py-4 text-sm transition hover:bg-white/5 sm:border-l sm:border-t-0"><span><span className="block font-medium">Cycle counts</span><span className="mt-1 block text-xs text-white/55">Keep physical and system stock aligned</span></span><ArrowRight size={17} className="text-amber transition group-hover:translate-x-1" /></Link>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;
          return <Link key={card.label} href={card.href} className="group rounded-xl border border-line bg-panel p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-rack/30 hover:shadow-md"><div className="flex items-start justify-between gap-3"><div className={`rounded-lg border p-2.5 ${toneClasses[card.tone]}`}><Icon size={19} /></div><ArrowRight size={17} className="mt-1 text-graphite transition group-hover:translate-x-1 group-hover:text-rack" /></div><p className="mt-5 text-xs font-semibold uppercase tracking-wide text-graphite">{card.label}</p><p className="mt-1 text-3xl font-semibold tracking-tight text-ink">{card.value}</p><p className="mt-1 text-sm text-graphite">{card.helper}</p></Link>;
        })}
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.1fr_1.9fr]">
        <div className="rounded-xl border border-line bg-panel p-5 shadow-sm">
          <div className="flex items-center justify-between"><div><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Priority queue</p><h3 className="mt-1 text-lg font-semibold">Next best actions</h3></div><ClipboardCheck size={20} className="text-rack" /></div>
          <div className="mt-5 space-y-3">
            {priorityItems.length ? priorityItems.map((item) => { const Icon = item.icon; return <Link key={item.title} href={item.href} className="group flex gap-3 rounded-lg border border-line p-3 transition hover:border-rack/30 hover:bg-paper"><div className={`mt-0.5 rounded-md border p-2 ${toneClasses[item.tone]}`}><Icon size={16} /></div><div className="min-w-0 flex-1"><p className="font-medium text-ink">{item.title}</p><p className="mt-1 text-xs leading-5 text-graphite">{item.detail}</p></div><ArrowRight size={16} className="mt-1 shrink-0 text-graphite transition group-hover:translate-x-1 group-hover:text-rack" /></Link>; }) : <div className="rounded-lg border border-dashed border-rack/30 bg-rack/5 p-5 text-sm text-graphite"><p className="font-medium text-ink">No urgent warehouse work.</p><p className="mt-1">Your allocated orders, open receipts, and low-stock locations are clear.</p></div>}
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-2 xl:grid-cols-1"><Link href="/partial-receipts" className="btn-secondary flex items-center justify-center gap-2"><Truck size={16} />Partial receive</Link><Link href="/reports" className="btn-secondary flex items-center justify-center gap-2"><FileDown size={16} />Open reports</Link></div>
        </div>

        <div className="rounded-xl border border-line bg-panel shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4"><div><p className="text-xs font-semibold uppercase tracking-wide text-graphite">Recent documents</p><h3 className="mt-1 text-lg font-semibold">Sales and inbound activity</h3></div><div className="inline-flex rounded-md border border-line bg-paper p-1">{(["ALL", "SALES", "PURCHASE"] as const).map((filter) => <button key={filter} type="button" onClick={() => setActivityFilter(filter)} className={`rounded px-3 py-1.5 text-xs font-medium transition ${activityFilter === filter ? "bg-panel text-ink shadow-sm" : "text-graphite hover:text-ink"}`}>{filter === "ALL" ? "All" : filter === "SALES" ? "Sales" : "Purchase"}</button>)}</div></div>
          {displayedActivity.length ? <div className="divide-y divide-line">{displayedActivity.map((item) => <Link key={`${item.kind}-${item.id}`} href={item.href} className="group grid gap-2 px-5 py-4 transition hover:bg-paper sm:grid-cols-[112px_1fr_auto] sm:items-center"><div className={`inline-flex w-fit items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold ${item.kind === "SALES" ? "bg-amber/15 text-amber-dark" : "bg-violet-100 text-violet-700"}`}>{item.kind === "SALES" ? <PackageCheck size={14} /> : <Truck size={14} />}{item.kind === "SALES" ? "Outbound" : "Inbound"}</div><div className="min-w-0"><p className="code-label font-medium text-rack">{item.reference}</p><p className="mt-1 truncate text-sm text-graphite">{item.counterparty || (item.kind === "SALES" ? "Customer not recorded" : "Supplier not recorded")}</p></div><div className="flex items-center justify-between gap-3 sm:justify-end"><div className="text-right"><StatusBadge status={item.status} /><p className="mt-1 text-xs text-graphite">{formattedTime(item.createdAt)}</p></div><ArrowRight size={16} className="text-graphite transition group-hover:translate-x-1 group-hover:text-rack" /></div></Link>)}</div> : <div className="px-5 py-12 text-center text-sm text-graphite">No {activityFilter === "ALL" ? "recent documents" : activityFilter.toLowerCase() + " documents"} to show yet.</div>}
        </div>
      </section>
    </div>
  );
}
