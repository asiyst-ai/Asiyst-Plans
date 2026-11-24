import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  OFFICIAL_PLANS,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { AsiystDodoGateway } from "@/lib/payments/dodo";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 6, "subscription-cancel");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;

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

  const planSlug = normalizeOfficialPlanSlug(sub.plan) || "zero";
  if (planSlug === "zero") {
    return jsonError(
      400,
      "CANNOT_CANCEL_FREE_PLAN",
      "Asiyst Zero is a free plan and cannot be cancelled.",
    );
  }

  if (sub.cancel_at_period_end) {
    return jsonError(
      409,
      "ALREADY_SCHEDULED_TO_CANCEL",
      "This subscription is already scheduled to cancel at the end of the current billing period.",
    );
  }

  if (!sub.dodo_subscription_id) {
    return jsonError(
      409,
      "MISSING_PROVIDER_SUBSCRIPTION_ID",
      "Subscription has no associated Dodo subscription ID.",
    );
  }

  const gateway = new AsiystDodoGateway();
  const providerUpdate = await gateway.updateCancellationState(
    String(sub.dodo_subscription_id),
    "cancel",
  );

  if (!providerUpdate.ok) {
    return jsonError(503, providerUpdate.errorCode, providerUpdate.error);
  }

  const requestId = randomUUID();
  await auth.admin.rpc("dodo_update_cancellation_state", {
    p_subscription_id: sub.id,
    p_organization_id: orgAccess.organization.id,
    p_cancel_at_period_end: true,
    p_request_id: requestId,
  });

  await auth.admin.from("subscription_change_history").insert({
    organization_id: orgAccess.organization.id,
    subscription_id: sub.id,
    actor_user_id: auth.user.id,
    change_type: "cancel_requested",
    previous_plan: planSlug,
    new_plan: planSlug,
    previous_status: sub.status,
    new_status: "cancellation_scheduled",
    amount_minor: sub.price_minor,
    currency: "USD",
  });

  await enqueueBillingNotification(auth.admin, {
    organizationId: orgAccess.organization.id,
    eventType: "billing.cancellation.requested",
    idempotencyKeyPrefix: `cancel_requested:${sub.id}:${requestId}`,
    payload: {
      eventType: "billing.cancellation.requested",
      organizationName: orgAccess.organization.name,
      planName: OFFICIAL_PLANS[planSlug].name,
      amountMinor: sub.price_minor ?? OFFICIAL_PLANS[planSlug].priceMinor,
      currency: "USD",
      periodEndDate: sub.current_period_end
        ? new Date(sub.current_period_end).toISOString().slice(0, 10)
        : "End of current billing period",
    },
  });

  return NextResponse.json({
    data: {
      subscriptionId: sub.id,
      state: "cancellation_scheduled",
      cancelAtPeriodEnd: true,
      effectiveDate: sub.current_period_end,
      remainingAccessActive: true,
    },
  });
}
