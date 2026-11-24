import { NextResponse, type NextRequest } from "next/server";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { buildAsiystWebSsoUrl } from "@/lib/auth/sso";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const returnPath = request.nextUrl.searchParams.get("returnPath") || "/plans";
  const plan = request.nextUrl.searchParams.get("plan");

  const loginUrl = buildAsiystWebSsoUrl({
    returnPath,
    plan,
    reauth: false,
  });
  const reauthUrl = buildAsiystWebSsoUrl({
    returnPath,
    plan,
    reauth: true,
  });

  const auth = await requireAuthenticatedUser(request, {
    requirePurchaseAuthorization: false,
    returnPath,
    plan,
  });

  if ("error" in auth) {
    return NextResponse.json(
      {
        data: {
          authenticated: false,
          purchaseAuthorized: false,
          purchaseAuthorization: {
            authorized: false,
            status: "missing",
            expiresAt: null,
            remainingSeconds: 0,
          },
          user: null,
          organization: null,
          loginUrl,
          reauthUrl,
        },
      },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
        },
      },
    );
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    null,
    false,
  );

  return NextResponse.json(
    {
      data: {
        authenticated: true,
        purchaseAuthorized: auth.purchaseAuthorization.authorized,
        purchaseAuthorization: auth.purchaseAuthorization,
        user: auth.user,
        organization: "error" in orgAccess ? null : orgAccess.organization,
        membership: "error" in orgAccess ? null : orgAccess.membership,
        loginUrl,
        reauthUrl,
      },
    },
    {
      headers: {
        "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
      },
    },
  );
}
