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
import { enqueueBillingNotification } from "@/lib/email/outbox";
import {
  AsiystDodoGateway,
  getDodoProductIdForPlan,
} from "@/lib/payments/dodo";

const downgradeSchema = z.object({
  targetPlan: z.string().min(1),
});

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 6, "subscription-downgrade");
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

  const parsed = downgradeSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "targetPlan is required.");
  }

  const targetSlug = normalizeOfficialPlanSlug(parsed.data.targetPlan);
  if (!targetSlug) {
    return jsonError(400, "INVALID_TARGET_PLAN", "Target plan must be Zero, Pulse, or Vector.");
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
  if (comparePlanRank(targetSlug, currentSlug) >= 0) {
    return jsonError(
      400,
      "NOT_A_DOWNGRADE",
      `Target plan (${OFFICIAL_PLANS[targetSlug].name}) must be a lower tier than your current plan (${OFFICIAL_PLANS[currentSlug].name}).`,
    );
  }

  if (!sub.dodo_subscription_id || sub.billing_provider !== "dodo") {
    return jsonError(
      409,
      "NO_ACTIVE_PAID_SUBSCRIPTION",
      "Only active paid subscriptions can be downgraded.",
    );
  }

  // If downgrading to Zero ($0), schedule end-of-period cancellation so paid access is preserved until current_period_end
  if (targetSlug === "zero") {
    const gateway = new AsiystDodoGateway();
    const cancelRes = await gateway.updateCancellationState(
      String(sub.dodo_subscription_id),
      "cancel",
    );
    if (!cancelRes.ok) {
      return jsonError(503, cancelRes.errorCode, cancelRes.error);
    }

    await auth.admin
      .from("subscriptions")
      .update({
        cancel_at_period_end: true,
        scheduled_plan: "zero",
        scheduled_change_effective_at: sub.current_period_end,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sub.id);

    await auth.admin.from("subscription_change_history").insert({
      organization_id: orgAccess.organization.id,
      subscription_id: sub.id,
      actor_user_id: auth.user.id,
      change_type: "downgrade_scheduled",
      previous_plan: currentSlug,
      new_plan: "zero",
      previous_status: sub.status,
      new_status: "cancellation_scheduled",
      amount_minor: 0,
      currency: "USD",
    });

    await enqueueBillingNotification(auth.admin, {
      organizationId: orgAccess.organization.id,
      eventType: "billing.subscription.plan_downgraded",
      idempotencyKeyPrefix: `downgrade:${sub.id}:zero:${Date.now()}`,
      payload: {
        eventType: "billing.subscription.plan_downgraded",
        organizationName: orgAccess.organization.name,
        planName: OFFICIAL_PLANS.zero.name,
        previousPlanName: OFFICIAL_PLANS[currentSlug].name,
        effectiveDate: sub.current_period_end
          ? new Date(sub.current_period_end).toISOString().slice(0, 10)
          : "End of current billing period",
      },
    });

    return NextResponse.json({
      data: {
        subscriptionId: sub.id,
        previousPlan: currentSlug,
        targetPlan: "zero",
        effectiveAt: sub.current_period_end,
        paidAccessPreservedUntilPeriodEnd: true,
      },
    });
  }

  if (!isPaidPlanSlug(targetSlug)) {
    return jsonError(400, "INVALID_TARGET_PLAN", "Invalid target plan.");
  }

  const targetProductId = getDodoProductIdForPlan(targetSlug);
  if (!targetProductId) {
    return jsonError(
      503,
      "DODO_PRODUCT_NOT_MAPPED",
      `Dodo product ID for ${OFFICIAL_PLANS[targetSlug].name} is not configured yet.`,
    );
  }

  const providedIdempotencyKey =
    request.headers.get("idempotency-key")?.trim() ||
    `asiyst_downgrade_${sub.id}_${targetSlug}_${String(sub.current_period_end || "now").slice(0, 10)}`;

  const gateway = new AsiystDodoGateway();
  const changeRes = await gateway.changeSubscriptionPlan(
    String(sub.dodo_subscription_id),
    targetProductId,
    "do_not_bill",
    {
      effectiveAt: "next_billing_date",
      onPaymentFailure: "prevent_change",
      cancelScheduledChangePlan: Boolean(sub.scheduled_plan),
      idempotencyKey: providedIdempotencyKey,
    },
  );

  if (!changeRes.ok) {
    return jsonError(503, changeRes.errorCode, changeRes.error);
  }

  await auth.admin
    .from("subscriptions")
    .update({
      scheduled_plan: targetSlug,
      scheduled_change_effective_at: sub.current_period_end,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  await auth.admin.from("subscription_change_history").insert({
    organization_id: orgAccess.organization.id,
    subscription_id: sub.id,
    actor_user_id: auth.user.id,
    change_type: "downgrade_scheduled",
    previous_plan: currentSlug,
    new_plan: targetSlug,
    previous_status: sub.status,
    new_status: sub.status,
    amount_minor: OFFICIAL_PLANS[targetSlug].priceMinor,
    currency: "USD",
  });

  return NextResponse.json({
    data: {
      subscriptionId: sub.id,
      previousPlan: currentSlug,
      targetPlan: targetSlug,
      effectiveAt: sub.current_period_end,
      paidAccessPreservedUntilPeriodEnd: true,
    },
  });
}
