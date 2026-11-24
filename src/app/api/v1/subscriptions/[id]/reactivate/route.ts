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
  const rateLimited = enforceRateLimit(request, 6, "subscription-reactivate");
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

  if (!sub.cancel_at_period_end) {
    return jsonError(
      409,
      "SUBSCRIPTION_NOT_SCHEDULED_TO_CANCEL",
      "This subscription is not scheduled to cancel.",
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
    "reactivate",
  );

  if (!providerUpdate.ok) {
    return jsonError(503, providerUpdate.errorCode, providerUpdate.error);
  }

  const requestId = randomUUID();
  await auth.admin.rpc("dodo_update_cancellation_state", {
    p_subscription_id: sub.id,
    p_organization_id: orgAccess.organization.id,
    p_cancel_at_period_end: false,
    p_request_id: requestId,
  });

  await auth.admin
    .from("subscriptions")
    .update({
      scheduled_plan: null,
      scheduled_change_effective_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", sub.id);

  const planSlug = normalizeOfficialPlanSlug(sub.plan) || "pulse";

  await auth.admin.from("subscription_change_history").insert({
    organization_id: orgAccess.organization.id,
    subscription_id: sub.id,
    actor_user_id: auth.user.id,
    change_type: "reactivated",
    previous_plan: planSlug,
    new_plan: planSlug,
    previous_status: "cancellation_scheduled",
    new_status: "active",
    amount_minor: sub.price_minor,
    currency: "USD",
  });

  await enqueueBillingNotification(auth.admin, {
    organizationId: orgAccess.organization.id,
    eventType: "billing.subscription.reactivated",
    idempotencyKeyPrefix: `reactivated:${sub.id}:${requestId}`,
    payload: {
      eventType: "billing.subscription.reactivated",
      organizationName: orgAccess.organization.name,
      planName: OFFICIAL_PLANS[planSlug].name,
      amountMinor: sub.price_minor ?? OFFICIAL_PLANS[planSlug].priceMinor,
      currency: "USD",
      nextRenewalDate: sub.current_period_end
        ? new Date(sub.current_period_end).toISOString().slice(0, 10)
        : undefined,
    },
  });

  return NextResponse.json({
    data: {
      subscriptionId: sub.id,
      state: "active",
      cancelAtPeriodEnd: false,
      nextRenewalDate: sub.current_period_end,
    },
  });
}
