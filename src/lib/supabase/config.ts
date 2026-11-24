export interface SupabaseResolvedConfig {
  url: string;
  key: string;
  isConfigured: boolean;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.find((v) => Boolean(v && v.trim()))?.trim() || "";
}

export function getPublicSupabaseConfig(): SupabaseResolvedConfig {
  const url = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_PRODUCTION_SUPABASE_URL,
    process.env.NEXT_PUBLIC_DEVELOPMENT_SUPABASE_URL,
  );
  const key = firstNonEmpty(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_PRODUCTION_SUPABASE_ANON_KEY,
    process.env.NEXT_PUBLIC_DEVELOPMENT_SUPABASE_ANON_KEY,
  );

  return {
    url,
    key,
    isConfigured: Boolean(url && key),
  };
}

export function getServerSupabaseConfig(
  role: "anon" | "service_role" = "anon",
): SupabaseResolvedConfig {
  if (process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SECURITY VIOLATION: NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY must never be defined.",
    );
  }

  const url = firstNonEmpty(
    process.env.SUPABASE_URL,
    process.env.PRODUCTION_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.DEVELOPMENT_SUPABASE_URL,
    process.env.NEXT_PUBLIC_DEVELOPMENT_SUPABASE_URL,
  );

  const key =
    role === "service_role"
      ? firstNonEmpty(
          process.env.SUPABASE_SERVICE_ROLE_KEY,
          process.env.PRODUCTION_SUPABASE_SERVICE_ROLE_KEY,
          process.env.DEVELOPMENT_SUPABASE_SERVICE_ROLE_KEY,
        )
      : firstNonEmpty(
          process.env.SUPABASE_ANON_KEY,
          process.env.PRODUCTION_SUPABASE_ANON_KEY,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          process.env.DEVELOPMENT_SUPABASE_ANON_KEY,
          process.env.NEXT_PUBLIC_DEVELOPMENT_SUPABASE_ANON_KEY,
        );

  return {
    url,
    key,
    isConfigured: Boolean(url && key),
  };
}

/**
 * Resolves optional cookie options for Supabase SSR when cross-subdomain cookie
 * sharing between `asiyst.com` and `plan.asiyst.com` is explicitly configured
 * via `AUTH_COOKIE_DOMAIN` or `NEXT_PUBLIC_AUTH_COOKIE_DOMAIN` (e.g., `.asiyst.com`).
 * Preserves default host-only cookie behavior when unset or on localhost.
 */
export function getSupabaseCookieOptions(hostname?: string):
  | {
      domain?: string;
      path: string;
      sameSite: "lax";
      secure?: boolean;
    }
  | undefined {
  const configuredDomain = firstNonEmpty(
    process.env.AUTH_COOKIE_DOMAIN,
    process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN,
  );
  if (!configuredDomain) {
    return undefined;
  }

  const normalizedDomain = configuredDomain.startsWith(".")
    ? configuredDomain.slice(1).toLowerCase()
    : configuredDomain.toLowerCase();

  if (
    !normalizedDomain ||
    normalizedDomain === "localhost" ||
    normalizedDomain === "127.0.0.1"
  ) {
    return undefined;
  }

  if (hostname) {
    const cleanHost = hostname.split(":")[0]?.toLowerCase() || "";
    if (
      cleanHost !== normalizedDomain &&
      !cleanHost.endsWith(`.${normalizedDomain}`)
    ) {
      return undefined;
    }
  }

  return {
    domain: `.${normalizedDomain}`,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  };
}
