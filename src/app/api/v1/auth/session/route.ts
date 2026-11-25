import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
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
          activeSubscription: null,
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

  let activeSubscription: {
    hasSubscriptionRecord: boolean;
    plan: string;
    status: string;
    isPaidActive: boolean;
  } | null = null;

  if (!("error" in orgAccess)) {
    const { entitlements } = await getOrganizationEffectiveEntitlements(
      auth.admin,
      orgAccess.organization.id,
    );
    activeSubscription = {
      hasSubscriptionRecord: Boolean(entitlements.subscriptionId),
      plan: entitlements.plan,
      status: entitlements.status,
      isPaidActive: entitlements.isPaidActive,
    };
  }

  return NextResponse.json(
    {
      data: {
        authenticated: true,
        purchaseAuthorized: auth.purchaseAuthorization.authorized,
        purchaseAuthorization: auth.purchaseAuthorization,
        user: auth.user,
        organization: "error" in orgAccess ? null : orgAccess.organization,
        membership: "error" in orgAccess ? null : orgAccess.membership,
        activeSubscription,
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
