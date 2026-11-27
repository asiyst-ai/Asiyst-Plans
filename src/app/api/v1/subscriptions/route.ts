import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const requestedOrgId =
    request.nextUrl.searchParams.get("organizationId") ||
    auth.organizationId ||
    null;
  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    requestedOrgId,
    true,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const { entitlements, rawSubscription } =
    await getOrganizationEffectiveEntitlements(
      auth.admin,
      orgAccess.organization.id,
    );

  const { data: history } = await auth.admin
    .from("subscription_change_history")
    .select("*")
    .eq("organization_id", orgAccess.organization.id)
    .order("created_at", { ascending: false })
    .limit(20);

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      membership: orgAccess.membership,
      subscription: rawSubscription,
      entitlements,
      history: history || [],
    },
  });
}
