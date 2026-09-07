"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { validateLoginInput } from "@/lib/auth";

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState(""); const [password, setPassword] = useState(""); const [error, setError] = useState<string | null>(null); const [loading, setLoading] = useState(false);
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(null);
    const input = validateLoginInput({ identifier, password });
    if (!input.valid) { setError(input.error); return; }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input.value) });
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error ?? "Unable to sign in right now. Try again shortly.");
      const requestedPath = new URLSearchParams(window.location.search).get("next");
      const destination = requestedPath?.startsWith("/") && !requestedPath.startsWith("//") ? requestedPath : "/dashboard";
      router.replace(destination);
      router.refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to sign in right now. Try again shortly."); }
    finally { setLoading(false); }
  }
  return <div className="min-h-screen flex items-center justify-center px-4"><div className="w-full max-w-sm"><div className="mb-10 flex items-baseline gap-2"><span className="stencil text-3xl text-ink">ProConnect</span><span className="code-label text-sm text-graphite">WMS</span></div><form onSubmit={handleSubmit} noValidate className="bg-panel border border-line p-6"><h1 className="text-lg font-semibold mb-1">Sign in</h1><p className="text-sm text-graphite mb-6">Use your User ID and password. Existing accounts can use email until their User ID is configured.</p><label className="block text-xs font-medium text-graphite mb-1" htmlFor="identifier">User ID</label><input id="identifier" autoComplete="username" required value={identifier} onChange={(event) => setIdentifier(event.target.value)} className="w-full mb-4 px-3 py-2 border border-line bg-paper text-ink text-sm focus:bg-panel" placeholder="your-user-id" disabled={loading} /><label className="block text-xs font-medium text-graphite mb-1" htmlFor="password">Password</label><input id="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} className="w-full mb-5 px-3 py-2 border border-line bg-paper text-ink text-sm focus:bg-panel" placeholder="••••••••" disabled={loading} />{error && <p role="alert" className="mb-4 text-sm text-alert border border-alert/30 bg-alert/5 px-3 py-2">{error}</p>}<button disabled={loading} className="w-full bg-ink text-white text-sm font-medium py-2.5 hover:bg-graphite transition-colors disabled:opacity-60">{loading ? "Signing in…" : "Sign in"}</button></form><p className="mt-4 text-xs text-graphite">Accounts are provisioned by your ProConnect administrator.</p></div></div>;
}
