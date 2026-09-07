"use client";

import { Search } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

export function InventorySearch({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const pathname = usePathname(); const router = useRouter(); const params = useSearchParams();
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params);
      if (query.trim()) next.set("q", query.trim()); else next.delete("q");
      next.delete("page");
      router.replace(`${pathname}${next.size ? `?${next}` : ""}`);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query, pathname, router, params]);
  return <label className="relative block max-w-md"><Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-graphite" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search SKU code or item name…" className="input-field pl-9" aria-label="Search inventory" /></label>;
}
