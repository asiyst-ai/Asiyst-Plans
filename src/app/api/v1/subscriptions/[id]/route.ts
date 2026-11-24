import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;

  const { data: sub, error } = await auth.admin
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !sub) {
    return jsonError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    String(sub.organization_id),
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const { entitlements } = await getOrganizationEffectiveEntitlements(
    auth.admin,
    String(sub.organization_id),
  );

  return NextResponse.json({
    data: {
      organization: orgAccess.organization,
      subscription: sub,
      entitlements,
    },
  });
}
