import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { OFFICIAL_PLANS } from "@/features/catalog/plans";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";

const freePlanSchema = z.object({
  organizationId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, 8, "free-plan-activation");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request, {
    requirePurchaseAuthorization: true,
    returnPath: "/checkout?plan=zero",
    plan: "zero",
  });
  if ("error" in auth) return auth.error;

  let rawBody: unknown = {};
  try {
    rawBody = await request.json();
  } catch {
    // Allow empty body
  }

  const parsed = freePlanSchema.safeParse(rawBody || {});
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "Invalid organization identifier.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    parsed.data.organizationId,
    true, // Owner or Billing Admin required
  );
  if ("error" in orgAccess) return orgAccess.error;

  const organizationId = orgAccess.organization.id;

  const { data: result, error: rpcError } = await auth.admin.rpc(
    "activate_organization_free_plan",
    {
      p_organization_id: organizationId,
      p_user_id: auth.user.id,
    },
  );

  if (rpcError) {
    return jsonError(
      500,
      "FREE_PLAN_ACTIVATION_ERROR",
      "Unable to verify Asiyst Zero eligibility.",
    );
  }

  if (result === "paid_subscription_exists") {
    return jsonError(
      409,
      "PAID_SUBSCRIPTION_ACTIVE",
      "This organization currently has an active paid subscription. Cancel your paid subscription first to transition to Asiyst Zero at the end of your billing period.",
    );
  }

  if (result === "not_authorized" || result === "not_a_member") {
    return jsonError(
      403,
      "BILLING_PERMISSION_REQUIRED",
      "Only the organization owner or an authorized billing administrator can change the organization plan.",
    );
  }

  if (result === "organization_not_found") {
    return jsonError(404, "ORGANIZATION_NOT_FOUND", "Organization not found.");
  }

  const { entitlements, rawSubscription } =
    await getOrganizationEffectiveEntitlements(auth.admin, organizationId);

  if (auth.purchaseAuthorization.id) {
    await auth.admin
      .from("plan_purchase_authorizations")
      .update({
        last_verified_at: new Date().toISOString(),
      })
      .eq("id", auth.purchaseAuthorization.id)
      .in("status", ["active", "checkout_initiated"]);
  }

  if (result === "activated") {
    await enqueueBillingNotification(auth.admin, {
      organizationId,
      eventType: "billing.subscription.activated",
      idempotencyKeyPrefix: `free_activated:${organizationId}:${rawSubscription?.id || "zero"}`,
      payload: {
        eventType: "billing.subscription.activated",
        organizationName: orgAccess.organization.name,
        productName: "Asiyst AI",
        planName: OFFICIAL_PLANS.zero.name,
        amountMinor: 0,
        currency: "USD",
        billingInterval: "Free ($0)",
        activationDate: new Date().toISOString().slice(0, 10),
        includedBenefits: [
          "1 project & 1 organization seat",
          "Basic AI website assistant & built-in 3D avatars",
          "Standard SDK & website integration",
        ],
      },
    });
  }

  return NextResponse.json(
    {
      data: {
        organization: orgAccess.organization,
        plan: "zero",
        alreadyActive: result === "already_active",
        subscription: rawSubscription,
        entitlements,
      },
    },
    { status: result === "already_active" ? 200 : 201 },
  );
}
