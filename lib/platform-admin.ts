import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// The layout and any nested server components can ask this in one render.
// Dedupe the database hit without caching a user's authorization across users.
export const isPlatformAdmin = cache(async function isPlatformAdmin(userId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !error && Boolean(data);
});
