import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OFFICIAL_PLANS,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import {
  AsiystDodoGateway,
  getPlanForDodoProductId,
} from "@/lib/payments/dodo";
import {
  activateVerifiedSubscriptionPayment,
  canTransitionPaymentState,
  recordPaymentAuditEvent,
  type PaymentLifecycleState,
} from "@/lib/payments/state-machine";

export interface OrderReconciliationResult {
  ok: boolean;
  orderId: string;
  paymentState: PaymentLifecycleState;
  activated: boolean;
  retryAllowed: boolean;
  invoiceNumber?: string | null;
  message: string;
}

/**
 * Reconciles a `billing_orders` purchase intent directly with Dodo Payments'
 * server API (Phase 5 & Phase 12).
 *
 * - Never activates a subscription on uncertain/pending responses.
 * - Never assumes failure and allows a duplicate charge while provider status is pending/unknown.
 * - Safely recovers delayed webhooks when Dodo confirms payment succeeded.
 */
export async function reconcileOrderWithProvider(input: {
  admin: SupabaseClient;
  orderId: string;
  gateway?: AsiystDodoGateway;
  nowMs?: number;
}): Promise<OrderReconciliationResult> {
  const { admin, orderId } = input;
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { data: order, error } = await admin
    .from("billing_orders")
    .select("*")
    .eq("id", orderId)
    .maybeSingle();

  if (error || !order) {
    return {
      ok: false,
      orderId,
      paymentState: "payment_failed",
      activated: false,
      retryAllowed: false,
      message: "Checkout purchase intent not found.",
    };
  }

  const currentState = String(
    order.payment_state ||
      (order.status === "completed" ? "payment_succeeded" : "checkout_pending"),
  ) as PaymentLifecycleState;

  if (currentState === "payment_succeeded" || order.status === "completed") {
    return {
      ok: true,
      orderId,
      paymentState: "payment_succeeded",
      activated: true,
      retryAllowed: false,
      message: "Payment is verified and subscription is active.",
    };
  }

  if (
    currentState === "payment_failed" ||
    currentState === "payment_cancelled" ||
    currentState === "expired"
  ) {
    return {
      ok: true,
      orderId,
      paymentState: currentState,
      activated: false,
      retryAllowed: true,
      message: `Previous checkout attempt ended in state '${currentState}'.`,
    };
  }

  const planSlug = normalizeOfficialPlanSlug(String(order.plan_slug || ""));
  if (!planSlug || !isPaidPlanSlug(planSlug)) {
    return {
      ok: false,
      orderId,
      paymentState: currentState,
      activated: false,
      retryAllowed: false,
      message: "Order plan slug is invalid.",
    };
  }

  const planDef = OFFICIAL_PLANS[planSlug];
  const subscriptionId = order.subscription_id
    ? String(order.subscription_id)
    : "";

  let dodoSubscriptionId: string | null = null;
  if (subscriptionId) {
    const { data: subRow } = await admin
      .from("subscriptions")
      .select("dodo_subscription_id, status")
      .eq("id", subscriptionId)
      .maybeSingle();
    if (subRow?.dodo_subscription_id) {
      dodoSubscriptionId = String(subRow.dodo_subscription_id);
    }
    if (subRow?.status === "active") {
      return {
        ok: true,
        orderId,
        paymentState: "payment_succeeded",
        activated: true,
        retryAllowed: false,
        message: "Subscription is already verified active.",
      };
    }
  }

  const providerSessionId = order.provider_checkout_id
    ? String(order.provider_checkout_id)
    : null;
  const expiresAtMs = order.expires_at
    ? Date.parse(String(order.expires_at))
    : Date.parse(String(order.created_at)) + 30 * 60 * 1000;
  const isPastExpiry = Number.isFinite(expiresAtMs) && expiresAtMs <= nowMs;

  // Query Dodo server API if any provider identifier exists
  if (providerSessionId || dodoSubscriptionId) {
    const gateway = input.gateway ?? new AsiystDodoGateway();
    const providerStatus = await gateway.retrieveAuthoritativeStatus({
      providerSessionId,
      providerSubscriptionId: dodoSubscriptionId,
    });

    await admin
      .from("billing_orders")
      .update({ last_reconciled_at: nowIso, updated_at: nowIso })
      .eq("id", orderId);

    if (providerStatus.ok && providerStatus.outcome === "succeeded" && subscriptionId) {
      const activation = await activateVerifiedSubscriptionPayment({
        admin,
        organizationId: String(order.organization_id),
        subscriptionId,
        orderId,
        userId: order.user_id ? String(order.user_id) : null,
        planSlug,
        productId: providerStatus.productId,
        providerSubscriptionId: providerStatus.providerSubscriptionId,
        providerPaymentId: providerStatus.providerPaymentId,
        amountMinor: providerStatus.amountMinor ?? planDef.priceMinor,
        currency: providerStatus.currency || "USD",
        currentPeriodStart: providerStatus.currentPeriodStart,
        currentPeriodEnd: providerStatus.currentPeriodEnd,
        eventSource: "provider_reconciliation",
      });

      if (activation.ok) {
        return {
          ok: true,
          orderId,
          paymentState: "payment_succeeded",
          activated: true,
          retryAllowed: false,
          invoiceNumber: activation.invoiceNumber,
          message: "Payment verified with Dodo Payments and subscription activated.",
        };
      }

      return {
        ok: false,
        orderId,
        paymentState: currentState,
        activated: false,
        retryAllowed: false,
        message: activation.message,
      };
    }

    if (
      providerStatus.ok &&
      (providerStatus.outcome === "failed" ||
        providerStatus.outcome === "cancelled" ||
        providerStatus.outcome === "expired")
    ) {
      const nextState: PaymentLifecycleState =
        providerStatus.outcome === "failed"
          ? "payment_failed"
          : providerStatus.outcome === "cancelled"
            ? "payment_cancelled"
            : "expired";

      if (canTransitionPaymentState(currentState, nextState)) {
        await admin
          .from("billing_orders")
          .update({
            status:
              nextState === "payment_failed"
                ? "failed"
                : nextState === "payment_cancelled"
                  ? "cancelled"
                  : "expired",
            payment_state: nextState,
            ...(nextState === "payment_cancelled" ? { cancelled_at: nowIso } : {}),
            last_reconciled_at: nowIso,
            updated_at: nowIso,
          })
          .eq("id", orderId);

        if (subscriptionId) {
          await admin
            .from("subscriptions")
            .update({
              status: nextState === "payment_failed" ? "payment_failed" : "incomplete",
              updated_at: nowIso,
            })
            .eq("id", subscriptionId)
            .eq("status", "pending");
        }

        await recordPaymentAuditEvent(admin, {
          organizationId: String(order.organization_id),
          orderId,
          subscriptionId: subscriptionId || null,
          previousState: currentState,
          newState: nextState,
          eventSource: "provider_reconciliation",
          amountMinor: Number(order.total_amount_minor || planDef.priceMinor),
          currency: "USD",
          reason: `Dodo Payments reported checkout status '${providerStatus.outcome}'.`,
        });

        if (nextState === "payment_failed") {
          try {
            await enqueueBillingNotification(admin, {
              organizationId: String(order.organization_id),
              eventType: "billing.payment.failed",
              idempotencyKeyPrefix: `order_failed:${orderId}`,
              payload: {
                eventType: "billing.payment.failed",
                planName: planDef.name,
                amountMinor: planDef.priceMinor,
                currency: "USD",
              },
            });
          } catch {
            // Non-fatal
          }
        }
      }

      return {
        ok: true,
        orderId,
        paymentState: nextState,
        activated: false,
        retryAllowed: true,
        message: `Payment ${providerStatus.outcome}; no subscription was activated.`,
      };
    }

    // Provider returned pending or unreachable — NEVER assume failure while provider might have charged
    return {
      ok: true,
      orderId,
      paymentState: currentState === "created" ? "checkout_pending" : currentState,
      activated: false,
      retryAllowed: false,
      message:
        "Payment verification is still pending with Dodo Payments. Do not submit a duplicate payment.",
    };
  }

  // No provider session created yet — if past expiry, mark expired safely
  if (isPastExpiry && canTransitionPaymentState(currentState, "expired")) {
    await admin
      .from("billing_orders")
      .update({
        status: "expired",
        payment_state: "expired",
        updated_at: nowIso,
      })
      .eq("id", orderId);

    if (subscriptionId) {
      await admin
        .from("subscriptions")
        .update({ status: "incomplete", updated_at: nowIso })
        .eq("id", subscriptionId)
        .eq("status", "pending");
    }

    await recordPaymentAuditEvent(admin, {
      organizationId: String(order.organization_id),
      orderId,
      subscriptionId: subscriptionId || null,
      previousState: currentState,
      newState: "expired",
      eventSource: "system_expiry",
      reason: "Uninitiated checkout order exceeded maximum lifetime.",
    });

    return {
      ok: true,
      orderId,
      paymentState: "expired",
      activated: false,
      retryAllowed: true,
      message: "Checkout session expired before payment was initiated.",
    };
  }

  return {
    ok: true,
    orderId,
    paymentState: currentState,
    activated: false,
    retryAllowed: false,
    message: "Checkout session is awaiting completion.",
  };
}

export interface SubscriptionReconciliationReport {
  checkedCount: number;
  updatedCount: number;
  expiredCount: number;
  discrepancies: Array<{
    subscriptionId: string;
    organizationId: string;
    issue: string;
    resolved: boolean;
  }>;
}

/**
 * Reconciles active/pending/past_due/scheduled Supabase subscription records
 * against authoritative Dodo Payments subscription state and billing period boundaries.
 */
export async function reconcileSubscriptionsWithProvider(input: {
  admin: SupabaseClient;
  organizationId?: string | null;
  gateway?: AsiystDodoGateway;
  nowMs?: number;
}): Promise<SubscriptionReconciliationReport> {
  const { admin } = input;
  const nowMs = input.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const gateway = input.gateway ?? new AsiystDodoGateway();

  let query = admin
    .from("subscriptions")
    .select("*")
    .in("status", [
      "active",
      "trialing",
      "past_due",
      "cancellation_scheduled",
      "canceled",
      "cancelled",
      "pending",
    ])
    .order("updated_at", { ascending: false })
    .limit(100);

  if (input.organizationId) {
    query = query.eq("organization_id", input.organizationId);
  }

  const { data: rows } = await query;
  const subs = (rows || []) as Array<Record<string, unknown>>;

  const report: SubscriptionReconciliationReport = {
    checkedCount: subs.length,
    updatedCount: 0,
    expiredCount: 0,
    discrepancies: [],
  };

  for (const sub of subs) {
    const subId = String(sub.id);
    const orgId = String(sub.organization_id);
    const planSlug = normalizeOfficialPlanSlug(String(sub.plan || "zero")) || "zero";
    if (planSlug === "zero") continue;

    const periodEndMs = sub.current_period_end
      ? Date.parse(String(sub.current_period_end))
      : NaN;

    // 1. Handle local period expiration for canceled subscriptions
    if (
      (sub.status === "canceled" ||
        sub.status === "cancelled" ||
        (sub.cancel_at_period_end && sub.scheduled_plan === "zero")) &&
      Number.isFinite(periodEndMs) &&
      periodEndMs <= nowMs
    ) {
      await admin
        .from("subscriptions")
        .update({
          status: "expired",
          scheduled_plan: null,
          scheduled_change_effective_at: null,
          updated_at: nowIso,
        })
        .eq("id", subId);

      // Ensure Zero fallback row is active
      await admin.rpc("activate_organization_free_plan", {
        p_organization_id: orgId,
        p_user_id: sub.user_id,
      });

      report.updatedCount += 1;
      report.expiredCount += 1;
      continue;
    }

    // 2. Query upstream Dodo subscription state when dodo_subscription_id is present
    const dodoSubId = sub.dodo_subscription_id ? String(sub.dodo_subscription_id) : "";
    if (!dodoSubId) continue;

    const remote = await gateway.retrieveSubscriptionDetails(dodoSubId);
    if (!remote.ok) {
      report.discrepancies.push({
        subscriptionId: subId,
        organizationId: orgId,
        issue: `Unable to query Dodo subscription ${dodoSubId}: ${remote.error}`,
        resolved: false,
      });
      continue;
    }

    const remotePlan = getPlanForDodoProductId(remote.productId);
    const scheduledPlan = remote.scheduledProductId
      ? getPlanForDodoProductId(remote.scheduledProductId)
      : null;

    if (remote.status === "active" && remotePlan && remotePlan !== planSlug) {
      const activation = await activateVerifiedSubscriptionPayment({
        admin,
        organizationId: orgId,
        subscriptionId: subId,
        userId: sub.user_id ? String(sub.user_id) : null,
        planSlug: remotePlan,
        productId: remote.productId,
        providerSubscriptionId: dodoSubId,
        amountMinor: remote.recurringAmountMinor || OFFICIAL_PLANS[remotePlan].priceMinor,
        currency: remote.currency,
        currentPeriodStart: remote.currentPeriodStart,
        currentPeriodEnd: remote.currentPeriodEnd,
        cancelAtPeriodEnd: remote.cancelAtNextBillingDate,
        isPlanChange: true,
        eventSource: "provider_reconciliation",
      });

      report.discrepancies.push({
        subscriptionId: subId,
        organizationId: orgId,
        issue: `Plan drift detected (local: ${planSlug}, Dodo: ${remotePlan})`,
        resolved: activation.ok,
      });
      if (activation.ok) report.updatedCount += 1;
    } else if (
      remote.cancelAtNextBillingDate !== Boolean(sub.cancel_at_period_end) ||
      (scheduledPlan && scheduledPlan !== sub.scheduled_plan)
    ) {
      await admin
        .from("subscriptions")
        .update({
          cancel_at_period_end: remote.cancelAtNextBillingDate,
          scheduled_plan: scheduledPlan || (remote.cancelAtNextBillingDate ? "zero" : null),
          scheduled_change_effective_at:
            remote.scheduledEffectiveAt || remote.currentPeriodEnd || sub.current_period_end,
          current_period_start: remote.currentPeriodStart || sub.current_period_start,
          current_period_end: remote.currentPeriodEnd || sub.current_period_end,
          updated_at: nowIso,
        })
        .eq("id", subId);

      report.updatedCount += 1;
      report.discrepancies.push({
        subscriptionId: subId,
        organizationId: orgId,
        issue: "Synchronized scheduled cancellation/downgrade metadata from Dodo",
        resolved: true,
      });
    } else if (
      (remote.status === "cancelled" || remote.status === "expired") &&
      !["canceled", "cancelled", "expired"].includes(String(sub.status))
    ) {
      const nextStatus =
        remote.currentPeriodEnd && Date.parse(remote.currentPeriodEnd) > nowMs
          ? "canceled"
          : "expired";
      await admin
        .from("subscriptions")
        .update({
          status: nextStatus,
          cancelled_at: nowIso,
          current_period_end: remote.currentPeriodEnd || sub.current_period_end,
          updated_at: nowIso,
        })
        .eq("id", subId);

      report.updatedCount += 1;
      if (nextStatus === "expired") report.expiredCount += 1;
      report.discrepancies.push({
        subscriptionId: subId,
        organizationId: orgId,
        issue: `Synchronized terminal status '${nextStatus}' from Dodo`,
        resolved: true,
      });
    }
  }

  return report;
}
