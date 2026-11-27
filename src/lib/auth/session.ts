import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildAsiystWebSsoUrl,
  verifyPlanSessionFromRequest,
  type PurchaseAuthorizationStatus,
} from "@/lib/auth/sso";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
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

export interface PurchaseAuthorizationContext {
  authorized: boolean;
  id: string | null;
  status: PurchaseAuthorizationStatus;
  expiresAt: string | null;
  remainingSeconds: number;
}

export interface AuthenticatedContext {
  user: {
    id: string;
    email: string;
    fullName?: string;
    emailConfirmed: boolean;
  };
  organizationId?: string | null;
  supabase?: SupabaseClient;
  admin: SupabaseClient;
  purchaseAuthorization: PurchaseAuthorizationContext;
}

export interface RequireAuthOptions {
  requirePurchaseAuthorization?: boolean;
  returnPath?: string | null;
  plan?: string | null;
}

export async function requireAuthenticatedUser(
  request: NextRequest,
  options: RequireAuthOptions = {},
): Promise<AuthenticatedContext | { error: NextResponse }> {
  const ssoLoginUrl = buildAsiystWebSsoUrl({
    returnPath: options.returnPath || "/checkout",
    plan: options.plan || null,
    reauth: false,
  });

  if (!isSupabaseAdminConfigured()) {
    return {
      error: jsonError(
        401,
        "ASIYST_LOGIN_REQUIRED",
        "Sign in to Asiyst to buy a plan or manage your organization subscription.",
        { loginUrl: ssoLoginUrl },
      ),
    };
  }

  const admin = createAdminClient();

  // 1. Check server-verified SSO session & short-lived 15-minute purchase authorization
  const planSession = await verifyPlanSessionFromRequest(request, admin);
  if (planSession.accountAuthenticated && planSession.user) {
    if (options.requirePurchaseAuthorization && !planSession.purchaseAuthorized) {
      const reauthUrl = buildAsiystWebSsoUrl({
        returnPath: options.returnPath || "/checkout",
        plan: options.plan || null,
        reauth: true,
      });

      const status = planSession.purchaseAuthorizationStatus;
      const isCompleted = status === "completed";
      return {
        error: jsonError(
          401,
          isCompleted
            ? "PURCHASE_AUTHORIZATION_ALREADY_USED"
            : "PURCHASE_AUTHORIZATION_EXPIRED",
          isCompleted
            ? "Your previous purchase authorization was already completed. Please confirm your Asiyst login to start a new purchase."
            : "Your temporary purchase session has expired. Please sign in again on Asiyst to continue purchasing.",
          {
            loginUrl: reauthUrl,
            reauthRequired: true,
            purchaseAuthorizationStatus: status,
          },
        ),
      };
    }

    return {
      user: planSession.user,
      organizationId: planSession.organizationId ?? null,
      admin,
      purchaseAuthorization: {
        authorized: planSession.purchaseAuthorized,
        id: planSession.purchaseAuthorizationId,
        status: planSession.purchaseAuthorizationStatus,
        expiresAt: planSession.purchaseExpiresAt,
        remainingSeconds: planSession.remainingPurchaseSeconds,
      },
    };
  }

  // If an SSO session cookie was present on the request and expired/revoked,
  // require fresh authentication if attempting a purchase
  if (
    options.requirePurchaseAuthorization &&
    planSession.purchaseAuthorizationStatus !== "missing"
  ) {
    const reauthUrl = buildAsiystWebSsoUrl({
      returnPath: options.returnPath || "/checkout",
      plan: options.plan || null,
      reauth: true,
    });
    return {
      error: jsonError(
        401,
        "PURCHASE_AUTHORIZATION_EXPIRED",
        "Your purchase session has expired. Please sign in again on Asiyst to continue purchasing.",
        {
          loginUrl: reauthUrl,
          reauthRequired: true,
          purchaseAuthorizationStatus: planSession.purchaseAuthorizationStatus,
        },
      ),
    };
  }

  // 2. Fallback: Check direct Supabase SSR session / Bearer token (e.g. if AUTH_COOKIE_DOMAIN or API token is used)
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
          "Sign in to Asiyst to buy a plan.",
          { loginUrl: ssoLoginUrl },
        ),
      };
    }

    // Enforce 15-minute freshness window on direct Supabase sessions when purchasing
    const lastSignInMs = data.user.last_sign_in_at
      ? Date.parse(data.user.last_sign_in_at)
      : NaN;
    const isFreshDirectPurchase =
      Number.isFinite(lastSignInMs) &&
      Date.now() - lastSignInMs <= 15 * 60 * 1000;

    if (options.requirePurchaseAuthorization && !isFreshDirectPurchase) {
      const reauthUrl = buildAsiystWebSsoUrl({
        returnPath: options.returnPath || "/checkout",
        plan: options.plan || null,
        reauth: true,
      });
      return {
        error: jsonError(
          401,
          "PURCHASE_AUTHORIZATION_EXPIRED",
          "Your purchase authorization window has expired. Please confirm your Asiyst login to continue purchasing.",
          {
            loginUrl: reauthUrl,
            reauthRequired: true,
            purchaseAuthorizationStatus: "expired",
          },
        ),
      };
    }

    const remainingDirectSec = isFreshDirectPurchase
      ? Math.max(0, Math.floor((lastSignInMs + 15 * 60 * 1000 - Date.now()) / 1000))
      : 0;

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
      purchaseAuthorization: {
        authorized: isFreshDirectPurchase,
        id: null,
        status: isFreshDirectPurchase ? "active" : "expired",
        expiresAt: isFreshDirectPurchase
          ? new Date(lastSignInMs + 15 * 60 * 1000).toISOString()
          : null,
        remainingSeconds: remainingDirectSec,
      },
    };
  } catch {
    return {
      error: jsonError(
        401,
        "ASIYST_LOGIN_REQUIRED",
        "Sign in to Asiyst to buy a plan.",
        { loginUrl: ssoLoginUrl },
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

export function hasMemberBillingPermission(member: {
  role?: string | null;
  can_manage_billing?: boolean | null;
  permissions?: unknown;
}): boolean {
  if (member.role === "owner" || Boolean(member.can_manage_billing)) {
    return true;
  }
  if (member.permissions && typeof member.permissions === "object") {
    return (member.permissions as Record<string, unknown>)["billing.manage"] === true;
  }
  return false;
}

export function isMembershipActive(member: { status?: string | null }): boolean {
  return member.status !== "suspended" && member.status !== "removed";
}

interface RawMembershipRow {
  organization_id: string;
  role: string;
  can_manage_billing?: boolean | null;
  permissions?: unknown;
  status?: string | null;
}

async function fetchUserMemberships(
  admin: SupabaseClient,
  userId: string,
  requestedOrgId?: string | null,
): Promise<{ data: RawMembershipRow[] | null; error: unknown }> {
  let query = admin
    .from("organization_members")
    .select("organization_id, role, can_manage_billing, permissions, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (requestedOrgId) {
    query = query.eq("organization_id", requestedOrgId);
  }

  const res = await query;
  if (!res.error) {
    return { data: (res.data as RawMembershipRow[] | null) ?? null, error: null };
  }

  // Safe fallback if older schema/mock lacks `permissions` or `status` columns
  let fallbackQuery = admin
    .from("organization_members")
    .select("organization_id, role, can_manage_billing")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (requestedOrgId) {
    fallbackQuery = fallbackQuery.eq("organization_id", requestedOrgId);
  }

  const fallbackRes = await fallbackQuery;
  return {
    data: (fallbackRes.data as RawMembershipRow[] | null) ?? null,
    error: fallbackRes.error,
  };
}

export async function listUserActiveOrganizations(
  admin: SupabaseClient,
  userId: string,
): Promise<
  Array<{
    id: string;
    name: string;
    role: OrganizationMemberRole;
    can_manage_billing: boolean;
  }>
> {
  const { data: memberships, error } = await fetchUserMemberships(admin, userId);
  if (error || !memberships) return [];

  const active = memberships.filter(isMembershipActive);
  if (active.length === 0) return [];

  const orgIds = active.map((m) => String(m.organization_id));
  const { data: orgs } = await admin
    .from("organizations")
    .select("id, name")
    .in("id", orgIds);

  const orgNameMap = new Map(
    (orgs || []).map((o) => [String(o.id), String(o.name)]),
  );

  return active
    .filter((m) => orgNameMap.has(String(m.organization_id)))
    .map((m) => ({
      id: String(m.organization_id),
      name: orgNameMap.get(String(m.organization_id)) || "Organization",
      role: m.role as OrganizationMemberRole,
      can_manage_billing: hasMemberBillingPermission(m),
    }));
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
  const { data: memberships, error: memError } = await fetchUserMemberships(
    admin,
    userId,
    requestedOrgId,
  );

  if (memError) {
    return {
      error: jsonError(
        500,
        "ORGANIZATION_LOOKUP_FAILED",
        "Unable to verify organization membership.",
      ),
    };
  }

  const activeMemberships = (memberships || []).filter(isMembershipActive);

  if (activeMemberships.length === 0) {
    return {
      error: jsonError(
        403,
        "FORBIDDEN_CROSS_ORGANIZATION",
        "You do not belong to the requested organization.",
      ),
    };
  }

  const chosen =
    activeMemberships.find((m) => m.role === "owner") ||
    activeMemberships.find((m) => hasMemberBillingPermission(m)) ||
    activeMemberships.find((m) => m.role === "admin") ||
    activeMemberships.find((m) => m.role === "manager") ||
    activeMemberships[0];

  const isBillingAuthorized = hasMemberBillingPermission(chosen);

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
