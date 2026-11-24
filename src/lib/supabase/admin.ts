import "server-only";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getServerSupabaseConfig } from "./config";

let cachedAdminClient: SupabaseClient | null = null;
let isTestingOverride = false;

export function createAdminClient(): SupabaseClient {
  if (typeof window !== "undefined") {
    throw new Error("createAdminClient is strictly server-only.");
  }

  if (isTestingOverride && cachedAdminClient) {
    return cachedAdminClient;
  }

  const config = getServerSupabaseConfig("service_role");
  if (!config.isConfigured) {
    throw new Error(
      "Supabase service role is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }

  return createSupabaseClient(config.url, config.key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}

export function isSupabaseAdminConfigured(): boolean {
  if (isTestingOverride && cachedAdminClient) {
    return true;
  }
  return getServerSupabaseConfig("service_role").isConfigured;
}

export function setAdminClientForTesting(client: SupabaseClient | null) {
  cachedAdminClient = client;
  isTestingOverride = client !== null;
}
