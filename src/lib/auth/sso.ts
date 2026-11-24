import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeOfficialPlanSlug } from "@/features/catalog/plans";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const PLAN_SESSION_COOKIE = "asiyst_plan_session";
export const PLAN_PURCHASE_AUTH_COOKIE = "asiyst_plan_purchase_auth";
export const PURCHASE_AUTH_TTL_SECONDS = 15 * 60; // 15 minutes short-lived purchase authorization
export const ACCOUNT_SESSION_TTL_SECONDS = 2 * 60 * 60; // 2 hours read-only account session on plan.asiyst.com

const SSO_CODE_PATTERN = /^asiyst_sso_[A-Za-z0-9_-]{32,128}$/;
const SESSION_TOKEN_PATTERN = /^asiyst_psess_[A-Za-z0-9_-]{32,128}$/;
const PURCHASE_TOKEN_PATTERN = /^asiyst_pauth_[A-Za-z0-9_-]{32,128}$/;

const ALLOWED_RETURN_PREFIXES = [
  "/",
  "/plans",
  "/products",
  "/offers",
  "/checkout",
  "/account",
];

function constantTimeHexMatch(hashA: string, hashB: string): boolean {
  if (!hashA || !hashB || hashA.length !== hashB.length) return false;
  return timingSafeEqual(Buffer.from(hashA, "utf8"), Buffer.from(hashB, "utf8"));
}

export function hashPlanSsoCode(code: string): string {
  return createHash("sha256")
    .update(`plan_sso_code:${code.trim()}`)
    .digest("hex");
}

export function hashPlanSessionToken(token: string): string {
  return createHash("sha256")
    .update(`plan_session_token:${token.trim()}`)
    .digest("hex");
}

export function hashPlanPurchaseToken(token: string): string {
  return createHash("sha256")
    .update(`plan_purchase_token:${token.trim()}`)
    .digest("hex");
}

export function generatePlanSessionToken(): string {
  return `asiyst_psess_${randomBytes(32).toString("base64url")}`;
}

export function generatePlanPurchaseToken(): string {
  return `asiyst_pauth_${randomBytes(32).toString("base64url")}`;
}

export function sanitizeInternalPlanPath(
  candidate?: string | null,
  fallbackPlan?: string | null,
): string {
  const normalizedPlan = normalizeOfficialPlanSlug(fallbackPlan);
  const fallback = normalizedPlan
    ? `/checkout?plan=${encodeURIComponent(normalizedPlan)}`
    : "/plans";

  if (!candidate || typeof candidate !== "string") return fallback;
  const trimmed = candidate.trim();
  if (
    !trimmed.startsWith("/") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/\\") ||
    trimmed.includes("\\") ||
    /[\r\n\t\0]/.test(trimmed)
  ) {
    return fallback;
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.includes("://") ||
    lower.includes("javascript:") ||
    lower.includes("data:") ||
    lower.includes("vbscript:")
  ) {
    return fallback;
  }

  try {
    const sentinel = "https://plan-internal.invalid";
    const parsed = new URL(trimmed, sentinel);
    if (parsed.origin !== sentinel) return fallback;

    const allowed = ALLOWED_RETURN_PREFIXES.some(
      (prefix) =>
        parsed.pathname === prefix ||
        (prefix !== "/" && parsed.pathname.startsWith(`${prefix}/`)),
    );
    if (!allowed) return fallback;

    parsed.searchParams.delete("code");
    parsed.searchParams.delete("token");
    parsed.searchParams.delete("access_token");
    parsed.searchParams.delete("refresh_token");

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

export function buildAsiystWebSsoUrl(options: {
  returnPath?: string | null;
  plan?: string | null;
  reauth?: boolean;
} = {}): string {
  const mainAppBase = (
    process.env.NEXT_PUBLIC_MAIN_APP_URL || "https://asiyst.com"
  )
    .trim()
    .replace(/\/+$/, "");

  const normalizedPlan = normalizeOfficialPlanSlug(options.plan);
  const safeReturnPath = sanitizeInternalPlanPath(
    options.returnPath,
    normalizedPlan,
  );

  const url = new URL("/api/v1/auth/sso/plan/start", mainAppBase);
  url.searchParams.set("returnPath", safeReturnPath);
  if (normalizedPlan) {
    url.searchParams.set("plan", normalizedPlan);
  }
  if (options.reauth) {
    url.searchParams.set("source", "reauth");
    url.searchParams.set("reauth", "1");
  } else {
    url.searchParams.set("source", "direct_plan_login");
  }
  return url.toString();
}

export function setPlanAuthCookies(
  response: NextResponse,
  tokens: {
    sessionToken: string;
    purchaseToken: string;
    purchaseMaxAgeSeconds?: number;
    accountMaxAgeSeconds?: number;
  },
): void {
  const isSecure = process.env.NODE_ENV === "production";

  response.cookies.set(PLAN_SESSION_COOKIE, tokens.sessionToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.accountMaxAgeSeconds ?? ACCOUNT_SESSION_TTL_SECONDS,
  });

  response.cookies.set(PLAN_PURCHASE_AUTH_COOKIE, tokens.purchaseToken, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.purchaseMaxAgeSeconds ?? PURCHASE_AUTH_TTL_SECONDS,
  });
}

export function clearPlanPurchaseCookieOnly(response: NextResponse): void {
  const isSecure = process.env.NODE_ENV === "production";
  response.cookies.set(PLAN_PURCHASE_AUTH_COOKIE, "", {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

export function clearAllPlanAuthCookies(response: NextResponse): void {
  const isSecure = process.env.NODE_ENV === "production";
  for (const name of [PLAN_SESSION_COOKIE, PLAN_PURCHASE_AUTH_COOKIE]) {
    response.cookies.set(name, "", {
      httpOnly: true,
      secure: isSecure,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}

export interface ConsumeSsoHandoffResult {
  ok: true;
  handoffId: string;
  purchaseAuthorizationId: string;
  userId: string;
  userEmail: string;
  userFullName?: string;
  emailConfirmed: boolean;
  organizationId: string | null;
  destinationPath: string;
  selectedPlan: string | null;
  sessionToken: string;
  purchaseToken: string;
  purchaseExpiresAt: string;
  accountExpiresAt: string;
}

export type ConsumeSsoHandoffErrorCode =
  | "INVALID_SSO_CODE"
  | "SSO_CODE_EXPIRED"
  | "SSO_CODE_ALREADY_USED"
  | "SSO_CODE_REVOKED"
  | "SSO_STATE_MISMATCH"
  | "USER_VERIFICATION_FAILED"
  | "SERVER_ERROR";

export async function consumeSsoHandoffCode(input: {
  code: string | null | undefined;
  state?: string | null;
  adminClient?: SupabaseClient;
  nowMs?: number;
}): Promise<
  | ConsumeSsoHandoffResult
  | { ok: false; status: number; code: ConsumeSsoHandoffErrorCode; message: string }
> {
  const rawCode = (input.code || "").trim();
  if (!rawCode || !SSO_CODE_PATTERN.test(rawCode)) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_SSO_CODE",
      message: "The authentication handoff code is missing or invalid.",
    };
  }

  if (!input.adminClient && !isSupabaseAdminConfigured()) {
    return {
      ok: false,
      status: 503,
      code: "SERVER_ERROR",
      message: "Authentication verification service is not configured.",
    };
  }

  const admin = input.adminClient ?? createAdminClient();
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const codeHash = hashPlanSsoCode(rawCode);
  const sessionToken = generatePlanSessionToken();
  const purchaseToken = generatePlanPurchaseToken();
  const sessionTokenHash = hashPlanSessionToken(sessionToken);
  const purchaseTokenHash = hashPlanPurchaseToken(purchaseToken);

  let consumedData: {
    handoff_id: string;
    purchase_authorization_id: string;
    user_id: string;
    organization_id: string | null;
    destination_path: string;
    selected_plan: string | null;
    state_nonce: string | null;
    purchase_expires_at: string;
    account_expires_at: string;
  } | null = null;

  // 1. Prefer atomic PostgreSQL FOR UPDATE RPC when available
  if (typeof admin.rpc === "function") {
    const rpcRes = await admin.rpc("consume_plan_sso_handoff", {
      p_code_hash: codeHash,
      p_session_token_hash: sessionTokenHash,
      p_purchase_token_hash: purchaseTokenHash,
      p_purchase_ttl_seconds: PURCHASE_AUTH_TTL_SECONDS,
      p_account_ttl_seconds: ACCOUNT_SESSION_TTL_SECONDS,
    });

    if (!rpcRes.error && rpcRes.data && typeof rpcRes.data === "object") {
      const payload = rpcRes.data as Record<string, unknown>;
      if (payload.ok === false) {
        const errCode = String(payload.code || "INVALID_SSO_CODE") as ConsumeSsoHandoffErrorCode;
        const status =
          errCode === "SSO_CODE_ALREADY_USED"
            ? 409
            : errCode === "SSO_CODE_EXPIRED"
              ? 410
              : errCode === "SSO_CODE_REVOKED"
                ? 403
                : 401;
        return {
          ok: false,
          status,
          code: errCode,
          message:
            errCode === "SSO_CODE_ALREADY_USED"
              ? "This authentication handoff has already been used."
              : errCode === "SSO_CODE_EXPIRED"
                ? "This authentication handoff expired. Please sign in again."
                : "Invalid authentication handoff.",
        };
      }
      if (payload.ok === true && typeof payload.user_id === "string") {
        consumedData = {
          handoff_id: String(payload.handoff_id),
          purchase_authorization_id: String(payload.purchase_authorization_id),
          user_id: String(payload.user_id),
          organization_id: payload.organization_id
            ? String(payload.organization_id)
            : null,
          destination_path: String(payload.destination_path || "/plans"),
          selected_plan: payload.selected_plan
            ? String(payload.selected_plan)
            : null,
          state_nonce: payload.state_nonce ? String(payload.state_nonce) : null,
          purchase_expires_at: String(payload.purchase_expires_at),
          account_expires_at: String(payload.account_expires_at),
        };
      }
    }
  }

  // 2. Fallback conditional atomic table transition (if RPC is not yet deployed or in mock tests)
  if (!consumedData) {
    const { data: handoff, error: findErr } = await admin
      .from("plan_sso_handoffs")
      .select("*")
      .eq("code_hash", codeHash)
      .maybeSingle();

    if (findErr || !handoff) {
      return {
        ok: false,
        status: 401,
        code: "INVALID_SSO_CODE",
        message: "The authentication handoff code is invalid or unrecognized.",
      };
    }

    if (handoff.status === "consumed" || handoff.consumed_at) {
      return {
        ok: false,
        status: 409,
        code: "SSO_CODE_ALREADY_USED",
        message: "This authentication handoff has already been used.",
      };
    }

    if (handoff.status === "revoked") {
      return {
        ok: false,
        status: 403,
        code: "SSO_CODE_REVOKED",
        message: "This authentication handoff was revoked.",
      };
    }

    if (
      handoff.status === "expired" ||
      new Date(String(handoff.expires_at)).getTime() <= nowMs
    ) {
      await admin
        .from("plan_sso_handoffs")
        .update({ status: "expired" })
        .eq("id", handoff.id)
        .eq("status", "issued");
      return {
        ok: false,
        status: 410,
        code: "SSO_CODE_EXPIRED",
        message: "This authentication handoff expired. Please sign in again.",
      };
    }

    const { data: updatedHandoff, error: consumeErr } = await admin
      .from("plan_sso_handoffs")
      .update({ status: "consumed", consumed_at: nowIso })
      .eq("id", handoff.id)
      .eq("status", "issued")
      .is("consumed_at", null)
      .select("id")
      .maybeSingle();

    if (consumeErr || !updatedHandoff) {
      return {
        ok: false,
        status: 409,
        code: "SSO_CODE_ALREADY_USED",
        message: "This authentication handoff has already been consumed.",
      };
    }

    await admin
      .from("plan_purchase_authorizations")
      .update({ status: "abandoned", abandoned_at: nowIso })
      .eq("user_id", handoff.user_id)
      .in("status", ["active", "checkout_initiated"]);

    const purchaseExpiresAt = new Date(
      nowMs + PURCHASE_AUTH_TTL_SECONDS * 1000,
    ).toISOString();
    const accountExpiresAt = new Date(
      nowMs + ACCOUNT_SESSION_TTL_SECONDS * 1000,
    ).toISOString();

    const { data: createdAuth, error: authInsertErr } = await admin
      .from("plan_purchase_authorizations")
      .insert({
        sso_handoff_id: handoff.id,
        session_token_hash: sessionTokenHash,
        purchase_token_hash: purchaseTokenHash,
        user_id: handoff.user_id,
        organization_id: handoff.organization_id || null,
        intended_plan: handoff.selected_plan || null,
        status: "active",
        issued_at: nowIso,
        purchase_expires_at: purchaseExpiresAt,
        account_expires_at: accountExpiresAt,
        last_verified_at: nowIso,
      })
      .select("id")
      .single();

    if (authInsertErr || !createdAuth?.id) {
      return {
        ok: false,
        status: 500,
        code: "SERVER_ERROR",
        message: "Unable to issue subscription purchase authorization.",
      };
    }

    consumedData = {
      handoff_id: String(handoff.id),
      purchase_authorization_id: String(createdAuth.id),
      user_id: String(handoff.user_id),
      organization_id: handoff.organization_id
        ? String(handoff.organization_id)
        : null,
      destination_path: String(handoff.destination_path || "/plans"),
      selected_plan: handoff.selected_plan
        ? String(handoff.selected_plan)
        : null,
      state_nonce: handoff.state_nonce ? String(handoff.state_nonce) : null,
      purchase_expires_at: purchaseExpiresAt,
      account_expires_at: accountExpiresAt,
    };
  }

  // 3. Validate optional state parameter if bound at issuance
  if (consumedData.state_nonce) {
    const providedState = (input.state || "").trim();
    const hashExpected = createHash("sha256")
      .update(consumedData.state_nonce)
      .digest("hex");
    const hashProvided = createHash("sha256")
      .update(providedState)
      .digest("hex");
    if (!providedState || !constantTimeHexMatch(hashExpected, hashProvided)) {
      await admin
        .from("plan_purchase_authorizations")
        .update({ status: "revoked", revoked_at: nowIso })
        .eq("id", consumedData.purchase_authorization_id);
      return {
        ok: false,
        status: 401,
        code: "SSO_STATE_MISMATCH",
        message: "Authentication state verification failed.",
      };
    }
  }

  // 4. Independently verify the user's Supabase Auth identity on the receiving backend
  const { data: userLookup, error: userErr } =
    await admin.auth.admin.getUserById(consumedData.user_id);

  if (userErr || !userLookup?.user || !userLookup.user.email) {
    await admin
      .from("plan_purchase_authorizations")
      .update({ status: "revoked", revoked_at: nowIso })
      .eq("id", consumedData.purchase_authorization_id);
    return {
      ok: false,
      status: 401,
      code: "USER_VERIFICATION_FAILED",
      message: "Unable to verify Asiyst account identity.",
    };
  }

  const verifiedUser = userLookup.user;
  const safeDestination = sanitizeInternalPlanPath(
    consumedData.destination_path,
    consumedData.selected_plan,
  );

  return {
    ok: true,
    handoffId: consumedData.handoff_id,
    purchaseAuthorizationId: consumedData.purchase_authorization_id,
    userId: verifiedUser.id,
    userEmail: verifiedUser.email || "",
    userFullName:
      typeof verifiedUser.user_metadata?.full_name === "string"
        ? verifiedUser.user_metadata.full_name
        : undefined,
    emailConfirmed: Boolean(verifiedUser.email_confirmed_at),
    organizationId: consumedData.organization_id,
    destinationPath: safeDestination,
    selectedPlan: consumedData.selected_plan,
    sessionToken,
    purchaseToken,
    purchaseExpiresAt: consumedData.purchase_expires_at,
    accountExpiresAt: consumedData.account_expires_at,
  };
}

export type PurchaseAuthorizationStatus =
  | "active"
  | "checkout_initiated"
  | "completed"
  | "expired"
  | "abandoned"
  | "revoked"
  | "missing";

export interface VerifiedPlanSession {
  accountAuthenticated: boolean;
  purchaseAuthorized: boolean;
  purchaseAuthorizationId: string | null;
  purchaseAuthorizationStatus: PurchaseAuthorizationStatus;
  purchaseExpiresAt: string | null;
  remainingPurchaseSeconds: number;
  user: {
    id: string;
    email: string;
    fullName?: string;
    emailConfirmed: boolean;
  } | null;
}

export async function verifyPlanSessionFromRequest(
  request: NextRequest,
  adminClient?: SupabaseClient,
  nowMs: number = Date.now(),
): Promise<VerifiedPlanSession> {
  const rawSessionToken =
    request.cookies.get(PLAN_SESSION_COOKIE)?.value?.trim() || "";
  const rawPurchaseToken =
    request.cookies.get(PLAN_PURCHASE_AUTH_COOKIE)?.value?.trim() || "";

  if (!rawSessionToken || !SESSION_TOKEN_PATTERN.test(rawSessionToken)) {
    return {
      accountAuthenticated: false,
      purchaseAuthorized: false,
      purchaseAuthorizationId: null,
      purchaseAuthorizationStatus: "missing",
      purchaseExpiresAt: null,
      remainingPurchaseSeconds: 0,
      user: null,
    };
  }

  if (!adminClient && !isSupabaseAdminConfigured()) {
    return {
      accountAuthenticated: false,
      purchaseAuthorized: false,
      purchaseAuthorizationId: null,
      purchaseAuthorizationStatus: "missing",
      purchaseExpiresAt: null,
      remainingPurchaseSeconds: 0,
      user: null,
    };
  }

  const admin = adminClient ?? createAdminClient();
  const sessionTokenHash = hashPlanSessionToken(rawSessionToken);

  const { data: authRow, error } = await admin
    .from("plan_purchase_authorizations")
    .select("*")
    .eq("session_token_hash", sessionTokenHash)
    .maybeSingle();

  if (error || !authRow) {
    return {
      accountAuthenticated: false,
      purchaseAuthorized: false,
      purchaseAuthorizationId: null,
      purchaseAuthorizationStatus: "missing",
      purchaseExpiresAt: null,
      remainingPurchaseSeconds: 0,
      user: null,
    };
  }

  const rowStatus = String(authRow.status || "expired") as PurchaseAuthorizationStatus;
  const accountExpiresMs = Date.parse(String(authRow.account_expires_at || ""));
  const purchaseExpiresMs = Date.parse(String(authRow.purchase_expires_at || ""));

  if (
    rowStatus === "revoked" ||
    !Number.isFinite(accountExpiresMs) ||
    accountExpiresMs <= nowMs
  ) {
    return {
      accountAuthenticated: false,
      purchaseAuthorized: false,
      purchaseAuthorizationId: String(authRow.id),
      purchaseAuthorizationStatus: rowStatus === "revoked" ? "revoked" : "expired",
      purchaseExpiresAt: authRow.purchase_expires_at
        ? String(authRow.purchase_expires_at)
        : null,
      remainingPurchaseSeconds: 0,
      user: null,
    };
  }

  // Independently verify user still exists in Supabase Auth
  const { data: userLookup, error: userErr } =
    await admin.auth.admin.getUserById(String(authRow.user_id));

  if (userErr || !userLookup?.user || !userLookup.user.email) {
    return {
      accountAuthenticated: false,
      purchaseAuthorized: false,
      purchaseAuthorizationId: String(authRow.id),
      purchaseAuthorizationStatus: "revoked",
      purchaseExpiresAt: null,
      remainingPurchaseSeconds: 0,
      user: null,
    };
  }

  const user = {
    id: userLookup.user.id,
    email: userLookup.user.email || "",
    fullName:
      typeof userLookup.user.user_metadata?.full_name === "string"
        ? userLookup.user.user_metadata.full_name
        : undefined,
    emailConfirmed: Boolean(userLookup.user.email_confirmed_at),
  };

  // Evaluate short-lived 15-minute purchase authorization independently of account view session
  let effectivePurchaseStatus: PurchaseAuthorizationStatus = rowStatus;
  if (
    (rowStatus === "active" || rowStatus === "checkout_initiated") &&
    (!Number.isFinite(purchaseExpiresMs) || purchaseExpiresMs <= nowMs)
  ) {
    effectivePurchaseStatus = "expired";
    await admin
      .from("plan_purchase_authorizations")
      .update({ status: "expired" })
      .eq("id", authRow.id)
      .in("status", ["active", "checkout_initiated"]);
  }

  const hasValidPurchaseCookie =
    Boolean(rawPurchaseToken) &&
    PURCHASE_TOKEN_PATTERN.test(rawPurchaseToken) &&
    constantTimeHexMatch(
      hashPlanPurchaseToken(rawPurchaseToken),
      String(authRow.purchase_token_hash || ""),
    );

  const isPurchaseActive =
    hasValidPurchaseCookie &&
    (effectivePurchaseStatus === "active" ||
      effectivePurchaseStatus === "checkout_initiated") &&
    purchaseExpiresMs > nowMs;

  if (!isPurchaseActive && effectivePurchaseStatus === "active") {
    effectivePurchaseStatus = rawPurchaseToken ? "expired" : "abandoned";
  }

  const remainingPurchaseSeconds = isPurchaseActive
    ? Math.max(0, Math.floor((purchaseExpiresMs - nowMs) / 1000))
    : 0;

  return {
    accountAuthenticated: true,
    purchaseAuthorized: isPurchaseActive,
    purchaseAuthorizationId: String(authRow.id),
    purchaseAuthorizationStatus: effectivePurchaseStatus,
    purchaseExpiresAt: authRow.purchase_expires_at
      ? String(authRow.purchase_expires_at)
      : null,
    remainingPurchaseSeconds,
    user,
  };
}
