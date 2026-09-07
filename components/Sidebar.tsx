"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clsx } from "clsx";
import {
  LayoutGrid,
  Package,
  MapPinned,
  ClipboardList,
  ScanLine,
  BarChart3,
  ShieldCheck,
  LogOut,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutGrid },
  { href: "/inventory", label: "Inventory", icon: Package },
  { href: "/locations", label: "Locations", icon: MapPinned },
  { href: "/orders", label: "Orders", icon: ClipboardList },
  { href: "/scan", label: "Scan", icon: ScanLine },
  { href: "/reports", label: "Reports", icon: BarChart3 },
];

export function Sidebar({ orgName, role }: { orgName: string; role: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function handleSignOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-56 shrink-0 bg-ink text-white flex flex-col min-h-screen">
      <div className="px-5 py-6 border-b border-white/10">
        <div className="stencil text-xl leading-none">ProConnect</div>
        <div className="code-label text-[11px] text-white/50 mt-1">WMS · {orgName}</div>
      </div>

      <nav className="flex-1 px-2 py-4 space-y-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
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
        {role === "owner" && (
          <Link
            href="/admin/users"
            className={clsx(
              "flex items-center gap-3 px-3 py-2 text-sm transition-colors",
              pathname.startsWith("/admin")
                ? "bg-amber text-ink font-medium"
                : "text-white/70 hover:bg-white/5 hover:text-white"
            )}
          >
            <ShieldCheck size={16} strokeWidth={2} />
            Administration
          </Link>
        )}
      </nav>

      <button
        onClick={handleSignOut}
        className="flex items-center gap-3 px-5 py-4 text-sm text-white/60 hover:text-white border-t border-white/10"
      >
        <LogOut size={16} />
        Sign out
      </button>
    </aside>
  );
}
