import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OFFICIAL_PLANS,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { AsiystDodoGateway } from "@/lib/payments/dodo";
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
