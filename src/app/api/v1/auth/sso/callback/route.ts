import { NextResponse, type NextRequest } from "next/server";
import { enforceRateLimit, jsonError } from "@/lib/auth/session";
import {
  ACCOUNT_SESSION_TTL_SECONDS,
  PURCHASE_AUTH_TTL_SECONDS,
  consumeSsoHandoffCode,
  setPlanAuthCookies,
} from "@/lib/auth/sso";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, 15, "sso-callback");
  if (rateLimited) return rateLimited;

  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const wantsJson =
    request.headers.get("accept")?.includes("application/json") ||
    request.nextUrl.searchParams.get("format") === "json";

  const consumed = await consumeSsoHandoffCode({ code, state });

  if (!consumed.ok) {
    if (wantsJson) {
      return jsonError(consumed.status, consumed.code, consumed.message);
    }

    const appOrigin =
      process.env.NEXT_PUBLIC_APP_URL ||
      request.nextUrl.origin ||
      "https://plan.asiyst.com";
    const fallbackUrl = new URL("/checkout", appOrigin);
    fallbackUrl.searchParams.set("sso_error", consumed.code.toLowerCase());
    const errRes = NextResponse.redirect(fallbackUrl, 302);
    errRes.headers.set(
      "Cache-Control",
      "private, no-cache, no-store, must-revalidate, max-age=0",
    );
    errRes.headers.set("Referrer-Policy", "no-referrer");
    return errRes;
  }

  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.nextUrl.origin ||
    "https://plan.asiyst.com";
  const targetUrl = new URL(consumed.destinationPath, appOrigin);

  const response = wantsJson
    ? NextResponse.json({
        data: {
          authenticated: true,
          purchaseAuthorized: true,
          userId: consumed.userId,
          destinationPath: consumed.destinationPath,
          purchaseExpiresAt: consumed.purchaseExpiresAt,
        },
      })
    : NextResponse.redirect(targetUrl, 302);

  setPlanAuthCookies(response, {
    sessionToken: consumed.sessionToken,
    purchaseToken: consumed.purchaseToken,
    purchaseMaxAgeSeconds: PURCHASE_AUTH_TTL_SECONDS,
    accountMaxAgeSeconds: ACCOUNT_SESSION_TTL_SECONDS,
  });

  response.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
