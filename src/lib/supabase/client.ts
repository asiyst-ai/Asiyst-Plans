"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getPublicSupabaseConfig, getSupabaseCookieOptions } from "./config";

export function createBrowserSupabaseClient() {
  const config = getPublicSupabaseConfig();
  if (!config.isConfigured) {
    throw new Error("Supabase public configuration is not set.");
  }

  const cookieOptions = getSupabaseCookieOptions(
    typeof window !== "undefined" ? window.location.hostname : undefined,
  );

  return createBrowserClient(config.url, config.key, {
    ...(cookieOptions ? { cookieOptions } : {}),
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
    },
  });
}
