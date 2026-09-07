"use client";

import type { Session, User } from "@supabase/supabase-js";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type AuthState = { user: User | null; session: Session | null; ready: boolean; signOut: () => Promise<void> };
const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [session, setSession] = useState<Session | null>(null); const [ready, setReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(({ data }) => { if (mounted) { setSession(data.session); setReady(true); } }).catch(() => { if (mounted) setReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { if (mounted) setSession(nextSession); });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [supabase]);
  async function signOut() {
    try { await supabase.auth.signOut({ scope: "local" }); }
    finally { setSession(null); router.replace("/login"); router.refresh(); }
  }
  const value = useMemo(() => ({ user: session?.user ?? null, session, ready, signOut }), [session, ready]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider.");
  return context;
}
