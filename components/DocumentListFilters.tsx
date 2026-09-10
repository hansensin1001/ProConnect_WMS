"use client";

import { FormEvent, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

export function DocumentListFilters({ initialQuery, initialStatus, placeholder, statuses }: { initialQuery: string; initialStatus: string; placeholder: string; statuses: string[] }) {
  const router = useRouter(); const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery); const [status, setStatus] = useState(initialStatus);
  function apply(event?: FormEvent) {
    event?.preventDefault(); const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim()); if (status) params.set("status", status);
    router.replace(`${pathname}${params.size ? `?${params}` : ""}`);
  }
  function clear() { setQuery(""); setStatus(""); router.replace(pathname); }
  return <form onSubmit={apply} className="mb-4 flex flex-col gap-2 sm:flex-row">
    <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={placeholder} className="input-field sm:max-w-md" />
    <select value={status} onChange={(event) => setStatus(event.target.value)} className="input-field sm:w-52"><option value="">All statuses</option>{statuses.map((item) => <option key={item} value={item}>{item.replaceAll("_", " ")}</option>)}</select>
    <button className="btn-secondary" type="submit">Apply</button>
    {(initialQuery || initialStatus || query || status) && <button className="btn-secondary" type="button" onClick={clear}>Clear</button>}
  </form>;
}
