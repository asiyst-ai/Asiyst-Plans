import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getServerSupabaseConfig, getSupabaseCookieOptions } from "./config";

export async function createServerSupabaseClient(accessToken?: string) {
  const config = getServerSupabaseConfig("anon");
  if (!config.isConfigured) {
    throw new Error("Supabase server configuration is missing.");
  }

  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  const host =
    headerStore.get("x-forwarded-host") || headerStore.get("host") || undefined;
  const cookieOptions = getSupabaseCookieOptions(host);

  return createServerClient(config.url, config.key, {
    ...(cookieOptions ? { cookieOptions } : {}),
    ...(accessToken
      ? { global: { headers: { Authorization: `Bearer ${accessToken}` } } }
      : {}),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server components cannot mutate cookies during render
        }
      },
    },
  });
}
