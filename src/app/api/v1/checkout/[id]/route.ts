import { NextResponse, type NextRequest } from "next/server";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;

  const { data: order, error } = await auth.admin
    .from("billing_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !order) {
    return jsonError(404, "ORDER_NOT_FOUND", "Checkout order not found.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    String(order.organization_id),
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  const { entitlements, rawSubscription } =
    await getOrganizationEffectiveEntitlements(
      auth.admin,
      String(order.organization_id),
    );

  return NextResponse.json({
    data: {
      order,
      subscription: rawSubscription,
      entitlements,
      isPaymentVerifiedAndActive:
        entitlements.isPaidActive &&
        entitlements.subscriptionId === order.subscription_id,
    },
  });
}
