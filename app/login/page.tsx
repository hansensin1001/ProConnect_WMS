"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      setError(signInError.message);
      setLoading(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex items-baseline gap-2">
          <span className="stencil text-3xl text-ink">ProConnect</span>
          <span className="code-label text-sm text-graphite">WMS</span>
        </div>

        <form onSubmit={handleSubmit} className="bg-panel border border-line p-6">
          <h1 className="text-lg font-semibold mb-1">Sign in</h1>
          <p className="text-sm text-graphite mb-6">
            Access your warehouse operations console.
          </p>

          <label className="block text-xs font-medium text-graphite mb-1" htmlFor="email">
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full mb-4 px-3 py-2 border border-line bg-paper text-ink text-sm focus:bg-panel"
            placeholder="you@company.com"
          />

          <label className="block text-xs font-medium text-graphite mb-1" htmlFor="password">
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full mb-5 px-3 py-2 border border-line bg-paper text-ink text-sm focus:bg-panel"
            placeholder="••••••••"
          />

          {error && (
            <p className="mb-4 text-sm text-alert border border-alert/30 bg-alert/5 px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-ink text-white text-sm font-medium py-2.5 hover:bg-graphite transition-colors disabled:opacity-60"
          >
            {loading ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-xs text-graphite">
          Accounts are provisioned by your ProConnect administrator.
        </p>
      </div>
    </div>
  );
}
