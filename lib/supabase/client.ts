import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // Supabase SSR uses cookies, rather than localStorage, for browser
      // sessions.  The browser client must be able to refresh its own cookie,
      // so HttpOnly requires a fully server-only auth migration.
      cookieOptions: {
        sameSite: "strict",
        secure: process.env.NODE_ENV === "production",
      },
    }
  );
}
