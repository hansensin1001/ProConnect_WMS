import { createClient } from "@/lib/supabase/server";

export async function isPlatformAdmin(userId: string) {
  const supabase = createClient();
  const { data, error } = await supabase.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle();
  return !error && Boolean(data);
}
