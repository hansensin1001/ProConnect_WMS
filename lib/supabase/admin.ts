import { createClient } from "@supabase/supabase-js";

/**
 * Server-only Supabase client for operations that must never be performed in
 * the browser (encrypted carrier configuration and verified webhooks).
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Carrier integration is not configured. Add SUPABASE_SERVICE_ROLE_KEY in Vercel.");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
