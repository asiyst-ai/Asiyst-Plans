import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import type { OrganizationMemberRole } from "@/types/billing";

export const ASIYST_WEB_LOGIN_URL = `${process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com"}/login`;

export function jsonError(
  status: number,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details ? { details } : {}),
      },
    },
    {
      status,
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      },
    },
  );
}

export function timingSafeSecretCompare(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  if (!provided || !expected) return false;
  const hashA = createHash("sha256").update(provided, "utf8").digest();
  const hashB = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(hashA, hashB);
}

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function enforceRateLimit(
  request: NextRequest | Request,
  maxPerMinute: number,
  scope: string,
): NextResponse | null {
  const ip =
    request.headers.get("cf-connecting-ip")?.trim() ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "local";

  if (rateLimitBuckets.size > 1000) {
    const nowCleanup = Date.now();
    for (const [k, v] of rateLimitBuckets.entries()) {
      if (nowCleanup >= v.resetAt) {
        rateLimitBuckets.delete(k);
      }
    }
  }

  const key = `${scope}:${ip}`;
  const now = Date.now();
  const entry = rateLimitBuckets.get(key);

  if (!entry || now >= entry.resetAt) {
    rateLimitBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }

  if (entry.count >= maxPerMinute) {
    return jsonError(
      429,
      "RATE_LIMIT_EXCEEDED",
      "Too many requests. Please wait a moment and try again.",
    );
  }

  entry.count += 1;
  return null;
}

export interface AuthenticatedContext {
  user: {
    id: string;
    email: string;
    fullName?: string;
    emailConfirmed: boolean;
  };
  supabase: SupabaseClient;
  admin: SupabaseClient;
}

export async function requireAuthenticatedUser(
  request: NextRequest,
): Promise<AuthenticatedContext | { error: NextResponse }> {
  if (!isSupabaseAdminConfigured()) {
    return {
      error: jsonError(
        401,
        "ASIYST_LOGIN_REQUIRED",
        "Please sign in to your Asiyst account before accessing subscription management or completing payment.",
        { loginUrl: ASIYST_WEB_LOGIN_URL },
      ),
    };
  }

  try {
    const authHeader = request.headers.get("authorization") || "";
    const bearerToken = authHeader.toLowerCase().startsWith("bearer ")
      ? authHeader.slice(7).trim()
      : undefined;

    const supabase = await createServerSupabaseClient(bearerToken);
    const { data, error } = await supabase.auth.getUser(bearerToken);

    if (error || !data?.user) {
      return {
        error: jsonError(
          401,
          "ASIYST_LOGIN_REQUIRED",
          "Please sign in to your Asiyst account to continue.",
          { loginUrl: ASIYST_WEB_LOGIN_URL },
        ),
      };
    }

    const admin = createAdminClient();
    return {
      user: {
        id: data.user.id,
        email: data.user.email || "",
        fullName:
          typeof data.user.user_metadata?.full_name === "string"
            ? data.user.user_metadata.full_name
            : undefined,
        emailConfirmed: Boolean(data.user.email_confirmed_at),
      },
      supabase,
      admin,
    };
  } catch {
    return {
      error: jsonError(
        401,
        "ASIYST_LOGIN_REQUIRED",
        "Please sign in to your Asiyst account to continue.",
        { loginUrl: ASIYST_WEB_LOGIN_URL },
      ),
    };
  }
}

export interface OrganizationAccess {
  organization: {
    id: string;
    name: string;
    owner_id: string;
  };
  membership: {
    role: OrganizationMemberRole;
    can_manage_billing: boolean;
  };
}

/**
 * Resolves the user's organization membership and verifies whether they have
 * billing management permissions (Owner or Authorized Billing Administrator).
 */
export async function resolveUserOrganizationAccess(
  admin: SupabaseClient,
  userId: string,
  requestedOrgId?: string | null,
  requireBillingPermission: boolean = false,
): Promise<OrganizationAccess | { error: NextResponse }> {
  let query = admin
    .from("organization_members")
    .select("organization_id, role, can_manage_billing")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (requestedOrgId) {
    query = query.eq("organization_id", requestedOrgId);
  }

  const { data: memberships, error: memError } = await query;

  if (memError) {
    return {
      error: jsonError(
        500,
        "ORGANIZATION_LOOKUP_FAILED",
        "Unable to verify organization membership.",
      ),
    };
  }

  if (!memberships || memberships.length === 0) {
    return {
      error: jsonError(
        403,
        "FORBIDDEN_CROSS_ORGANIZATION",
        "You do not belong to the requested organization.",
      ),
    };
  }

  const chosen =
    memberships.find((m) => m.role === "owner" || m.can_manage_billing) ||
    memberships[0];

  const isBillingAuthorized =
    chosen.role === "owner" || Boolean(chosen.can_manage_billing);

  if (requireBillingPermission && !isBillingAuthorized) {
    return {
      error: jsonError(
        403,
        "BILLING_PERMISSION_REQUIRED",
        "Only the organization owner or an authorized billing administrator can perform billing operations.",
      ),
    };
  }

  const { data: org, error: orgError } = await admin
    .from("organizations")
    .select("id, name, owner_id")
    .eq("id", chosen.organization_id)
    .maybeSingle();

  if (orgError || !org) {
    return {
      error: jsonError(404, "ORGANIZATION_NOT_FOUND", "Organization not found."),
    };
  }

  return {
    organization: {
      id: String(org.id),
      name: String(org.name),
      owner_id: String(org.owner_id),
    },
    membership: {
      role: chosen.role as OrganizationMemberRole,
      can_manage_billing: isBillingAuthorized,
    },
  };
}
