import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  OFFICIAL_PLANS,
  comparePlanRank,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import {
  AsiystDodoGateway,
  getDodoProductIdForPlan,
} from "@/lib/payments/dodo";

const upgradeSchema = z.object({
  targetPlan: z.string().min(1),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 6, "subscription-upgrade");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = upgradeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "targetPlan is required.");
  }

  const targetSlug = normalizeOfficialPlanSlug(parsed.data.targetPlan);
  if (!targetSlug || !isPaidPlanSlug(targetSlug)) {
    return jsonError(400, "INVALID_TARGET_PLAN", "Target plan must be Pulse, Vector, or Quantum.");
  }

  const { data: sub } = await auth.admin
    .from("subscriptions")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!sub) {
    return jsonError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    String(sub.organization_id),
    true, // Owner or Billing Admin required
  );
  if ("error" in orgAccess) return orgAccess.error;

  const currentSlug = normalizeOfficialPlanSlug(sub.plan) || "zero";
  if (comparePlanRank(targetSlug, currentSlug) <= 0) {
    return jsonError(
      400,
      "NOT_AN_UPGRADE",
      `Target plan (${OFFICIAL_PLANS[targetSlug].name}) must be a higher tier than your current plan (${OFFICIAL_PLANS[currentSlug].name}).`,
    );
  }

  if (sub.cancel_at_period_end) {
    return jsonError(
      409,
      "SUBSCRIPTION_SCHEDULED_TO_CANCEL",
      "Reactivate your subscription before upgrading plans.",
    );
  }

  if (!sub.dodo_subscription_id || sub.billing_provider !== "dodo") {
    return jsonError(
      409,
      "CHECKOUT_REQUIRED_FOR_FIRST_PAID_PLAN",
      "Upgrading from Asiyst Zero requires completing a Dodo checkout session via POST /api/v1/checkout/session.",
    );
  }

  const targetProductId = getDodoProductIdForPlan(targetSlug);
  if (!targetProductId) {
    return jsonError(
      503,
      "DODO_PRODUCT_NOT_MAPPED",
      `Dodo product ID for ${OFFICIAL_PLANS[targetSlug].name} is not configured yet.`,
    );
  }

  const gateway = new AsiystDodoGateway();
  const changeResult = await gateway.changeSubscriptionPlan(
    String(sub.dodo_subscription_id),
    targetProductId,
    "prorated_immediately",
  );

  if (!changeResult.ok) {
    return jsonError(
      503,
      changeResult.errorCode || "UPGRADE_PROVIDER_ERROR",
      changeResult.error,
    );
  }

  await auth.admin.from("subscription_change_history").insert({
    organization_id: orgAccess.organization.id,
    subscription_id: sub.id,
    actor_user_id: auth.user.id,
    change_type: "upgraded",
    previous_plan: currentSlug,
    new_plan: targetSlug,
    previous_status: sub.status,
    new_status: sub.status,
    amount_minor: OFFICIAL_PLANS[targetSlug].priceMinor,
    currency: "USD",
    metadata: { requested_via: "api_upgrade", awaiting_webhook_confirmation: true },
  });

  return NextResponse.json({
    data: {
      subscriptionId: sub.id,
      previousPlan: currentSlug,
      targetPlan: targetSlug,
      status: "upgrade_requested_awaiting_provider_confirmation",
      message:
        "Upgrade submitted to Dodo Payments. Updated entitlements and confirmation email will activate immediately upon verified provider confirmation.",
    },
  });
}
