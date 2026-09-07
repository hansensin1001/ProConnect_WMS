"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function PageNavigation({ page, pageSize, total }: { page: number; pageSize: number; total: number }) {
  const router = useRouter(); const pathname = usePathname(); const params = useSearchParams();
  const start = total ? (page - 1) * pageSize + 1 : 0;
  const end = Math.min(page * pageSize, total);
  function go(next: number) { const query = new URLSearchParams(params); query.set("page", String(next)); router.push(`${pathname}?${query.toString()}`); }
  return <div className="flex items-center justify-between border-t border-line px-5 py-3 text-sm text-graphite"><span>Showing {start}–{end} of {total}</span><div className="flex gap-1"><button aria-label="Previous page" disabled={page <= 1} onClick={() => go(page - 1)} className="btn-secondary p-2"><ChevronLeft size={16}/></button><button aria-label="Next page" disabled={end >= total} onClick={() => go(page + 1)} className="btn-secondary p-2"><ChevronRight size={16}/></button></div></div>;
}
