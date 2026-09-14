"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutGrid,
  Menu,
  X,
  PackagePlus,
  PackageMinus,
  PackageOpen,
  Undo2,
  Redo2,
  Warehouse,
  Package,
  MapPinned,
  ClipboardList,
  ClipboardCheck,
  Truck,
  RotateCcw,
  ScanLine,
  BarChart3,
  ShieldCheck,
  Settings2,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/components/AuthProvider";
import { SCAN_MODULE_ENABLED } from "@/lib/features";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/locations", label: "Locations", icon: MapPinned },
  { href: "/orders", label: "Sales Orders", icon: ClipboardList },
  { href: "/partial-shipments", label: "Partial Shipments", icon: PackageMinus },
  { href: "/purchase-orders", label: "Purchase Orders", icon: PackagePlus },
  { href: "/partial-receipts", label: "Partial Receive", icon: PackageOpen },
  { href: "/rma-returns", label: "Customer Returns", icon: Undo2 },
  { href: "/rtv-returns", label: "Vendor Returns", icon: Redo2 },
  { href: "/cycle-counts", label: "Cycle Counts", icon: ClipboardCheck },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];
const SCAN_NAV = { href: "/scan", label: "Scan", icon: ScanLine };

export function Sidebar({ orgName, isPlatformAdmin, canManageCarriers }: { orgName: string; isPlatformAdmin: boolean; canManageCarriers: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  useEffect(() => setMobileOpen(false), [pathname]);

  async function handleSignOut() {
    try { await signOut(); } catch { setLogoutError("Unable to sign out. Please try again."); }
  }

  return (
    <>
      <div className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between bg-ink px-4 text-white md:hidden"><span className="flex items-center gap-2 font-semibold"><Warehouse size={22} className="text-amber" />ProConnect WMS</span><button type="button" aria-label="Open navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(true)} className="flex h-11 w-11 items-center justify-center"><Menu /></button></div>
      {mobileOpen && <button type="button" className="fixed inset-0 z-50 bg-ink/40 md:hidden" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <aside className={clsx("fixed inset-y-0 left-0 z-[60] w-64 shrink-0 flex-col overflow-y-auto bg-ink text-white md:sticky md:top-0 md:z-30 md:flex md:h-screen md:w-56", mobileOpen ? "flex" : "hidden")}>
      <button type="button" onClick={() => setMobileOpen(false)} className="ml-auto flex h-11 w-11 items-center justify-center md:hidden" aria-label="Close navigation"><X /></button>
      <div className="border-b border-white/10 px-4 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber text-ink shadow-sm">
            <Warehouse size={22} strokeWidth={2.25} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="stencil text-xl leading-none">ProConnect</div>
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber/90">Warehouse operations</div>
          </div>
        </div>
        <div className="code-label mt-3 truncate text-[11px] text-white/50" title={orgName}>Active organization · {orgName}</div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {(SCAN_MODULE_ENABLED ? [...NAV, SCAN_NAV] : NAV).map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setMobileOpen(false)}
              aria-current={active ? "page" : undefined}
              prefetch
              onMouseEnter={() => router.prefetch(href)}
              className={clsx(
                "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-amber text-ink font-medium"
                  : "text-white/70 hover:bg-white/5 hover:text-white"
              )}
            >
              <Icon size={16} strokeWidth={2} />
              {label}
            </Link>
          );
        })}
        {isPlatformAdmin && (
          <Link
            href="/admin/users"
            prefetch
            onMouseEnter={() => router.prefetch("/admin/users")}
            className={clsx(
              "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/admin")
                ? "bg-amber text-ink font-medium"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <ShieldCheck size={16} strokeWidth={2} />
            Administration
          </Link>
        )}
        {canManageCarriers && (
          <Link
            href="/settings/carriers"
            prefetch
            onMouseEnter={() => router.prefetch("/settings/carriers")}
            className={clsx(
              "flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/settings/carriers")
                ? "bg-amber text-ink font-medium"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <Settings2 size={16} strokeWidth={2} />
            Manage Carriers
          </Link>
        )}
      </nav>

      {logoutError && <p role="alert" className="px-4 py-2 text-sm text-red-200">{logoutError}</p>}
      <button
        onClick={handleSignOut}
        className="flex items-center gap-3 px-5 py-4 text-sm text-white/60 hover:text-white border-t border-white/10"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </aside></>
  );
}
