import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit } from "@/lib/auth/session";
import {
  PLAN_SESSION_COOKIE,
  clearAllPlanAuthCookies,
  clearPlanPurchaseCookieOnly,
  hashPlanSessionToken,
} from "@/lib/auth/sso";
import { createAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/**
 * Invalidates the temporary subscription purchase authorization (e.g. when a user
 * explicitly abandons checkout or signs out of plan.asiyst.com) WITHOUT destroying
 * the user's primary Asiyst-WEB dashboard session on asiyst.com.
 */
export async function POST(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, 15, "sso-abandon");
  if (rateLimited) return rateLimited;

  let fullSignOut = false;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    fullSignOut = body?.signOutAccountView === true;
  } catch {
    // Default: invalidate purchase authorization only
  }

  const rawSession = request.cookies.get(PLAN_SESSION_COOKIE)?.value?.trim();
  if (rawSession && isSupabaseAdminConfigured()) {
    const admin = createAdminClient();
    const sessionHash = hashPlanSessionToken(rawSession);
    const nowIso = new Date().toISOString();

    await admin
      .from("plan_purchase_authorizations")
      .update(
        fullSignOut
          ? { status: "revoked", revoked_at: nowIso }
          : { status: "abandoned", abandoned_at: nowIso },
      )
      .eq("session_token_hash", sessionHash)
      .in("status", ["active", "checkout_initiated"]);
  }

  const response = NextResponse.json(
    {
      data: {
        invalidated: true,
        scope: fullSignOut ? "plan_session" : "purchase_authorization",
        mainDashboardSessionPreserved: true,
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      },
    },
  );

  if (fullSignOut) {
    clearAllPlanAuthCookies(response);
  } else {
    clearPlanPurchaseCookieOnly(response);
  }

  return response;
}
