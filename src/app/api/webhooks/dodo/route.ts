import { NextResponse, type NextRequest } from "next/server";
import {
  OFFICIAL_PLANS,
  comparePlanRank,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import { jsonError } from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { AsiystDodoGateway } from "@/lib/payments/dodo";
import {
  activateVerifiedSubscriptionPayment,
  recordPaymentAuditEvent,
  type PaymentLifecycleState,
} from "@/lib/payments/state-machine";
import {
  createAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  let rawPayload: string;
  try {
    rawPayload = await request.text();
  } catch {
    return jsonError(400, "INVALID_PAYLOAD", "Unable to read webhook request body.");
  }

  const gateway = new AsiystDodoGateway();
  const verification = gateway.verifyWebhookSignature(rawPayload, {
    webhookId: request.headers.get("webhook-id"),
    webhookTimestamp: request.headers.get("webhook-timestamp"),
    webhookSignature:
      request.headers.get("webhook-signature") ||
      request.headers.get("stripe-signature"),
  });

  if (!verification.valid) {
    return jsonError(
      401,
      "INVALID_WEBHOOK_SIGNATURE",
      verification.error || "Webhook cryptographic signature verification failed.",
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return jsonError(
      503,
      "SUPABASE_NOT_CONFIGURED",
      "Supabase service role is not configured on the server.",
    );
  }

  const admin = createAdminClient();
  const { event } = verification;

  // 1. Idempotency check in billing_webhook_events
  const { data: existingEvent } = await admin
    .from("billing_webhook_events")
    .select("id, processing_status")
    .eq("provider_event_id", event.eventId)
    .maybeSingle();

  if (existingEvent && existingEvent.processing_status === "processed") {
    return NextResponse.json({
      received: true,
      duplicate: true,
      eventId: event.eventId,
    });
  }

  await admin.from("billing_webhook_events").upsert(
    {
      provider: "dodo",
      provider_event_id: event.eventId,
      organization_id: event.organizationId || null,
      event_type: event.rawEventType,
      processing_status: "processing",
      payload: JSON.parse(rawPayload),
      received_at: new Date().toISOString(),
    },
    { onConflict: "provider_event_id" },
  );

  try {
    // Resolve target subscription row
    let subRow: Record<string, unknown> | null = null;
    if (event.subscriptionId) {
      const { data } = await admin
        .from("subscriptions")
        .select("*")
        .eq("id", event.subscriptionId)
        .maybeSingle();
      subRow = data;
    }
    if (!subRow && event.providerSubscriptionId) {
      const { data } = await admin
        .from("subscriptions")
        .select("*")
        .eq("dodo_subscription_id", event.providerSubscriptionId)
        .maybeSingle();
      subRow = data;
    }

    const organizationId =
      event.organizationId ||
      (subRow?.organization_id ? String(subRow.organization_id) : undefined);

    if (!organizationId || !subRow) {
      await admin
        .from("billing_webhook_events")
        .update({
          processing_status: "failed",
          error_message: "Missing organization or subscription mapping",
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", event.eventId);

      return jsonError(
        400,
        "MISSING_SUBSCRIPTION_MAPPING",
        "Webhook event could not be matched to a known organization subscription.",
      );
    }

    // Ownership guard: metadata organization_id must match subscription's organization_id
    if (
      event.organizationId &&
      String(subRow.organization_id) !== event.organizationId
    ) {
      await admin
        .from("billing_webhook_events")
        .update({
          processing_status: "failed",
          error_message: "Organization mismatch between webhook metadata and subscription",
          processed_at: new Date().toISOString(),
        })
        .eq("provider_event_id", event.eventId);

      return jsonError(
        403,
        "ORGANIZATION_MISMATCH",
        "Webhook organization metadata does not match the target subscription.",
      );
    }

    const { data: orgRow } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    const organizationName = String(orgRow?.name || "Your Organization");

    const previousPlanSlug =
      normalizeOfficialPlanSlug(String(subRow.plan || "zero")) || "zero";
    const resolvedCandidate =
      event.planSlug ||
      normalizeOfficialPlanSlug(String(subRow.plan || "pulse")) ||
      "pulse";
    const targetPlanSlug = isPaidPlanSlug(resolvedCandidate)
      ? resolvedCandidate
      : "pulse";
    const planDef = OFFICIAL_PLANS[targetPlanSlug];
    const previousStatus = String(subRow.status || "pending").toLowerCase();

    // Case A: Dunning / Payment Recovery
    if (event.normalizedKind === "subscription.recovered") {
      await admin
        .from("subscriptions")
        .update({
          status: "active",
          billing_recovery_deadline: null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", subRow.id);

      await enqueueBillingNotification(admin, {
        organizationId,
        eventType: "billing.payment.recovered",
        idempotencyKeyPrefix: `dodo:${event.eventId}:recovered`,
        payload: {
          eventType: "billing.payment.recovered",
          organizationName,
          planName: planDef.name,
          amountMinor: event.amountMinor || planDef.priceMinor,
          currency: event.currency,
          transactionReference: event.providerPaymentId,
        },
      });
    }

    // Case B: Subscription Lifecycle Transition
    else if (event.normalizedKind === "subscription.lifecycle") {
      const statusMap: Record<string, string> = {
        active: "active",
        activated: "active",
        renewed: "active",
        plan_changed: "active",
        resumed: "active",
        unpaused: "active",
        trialing: "trialing",
        pending: "pending",
        created: "pending",
        past_due: "past_due",
        payment_failed: "past_due",
        on_hold: "paused",
        paused: "paused",
        cancelled: "canceled",
        canceled: "canceled",
        expired: "expired",
        failed: "payment_failed",
      };

      const nextStatus =
        statusMap[event.subscriptionStatus || "active"] || "active";

      // Guard against out-of-order backwards transition (active -> pending) or activating a failed/cancelled sub directly
      if (
        nextStatus === "pending" &&
        ["active", "trialing", "past_due", "canceled", "expired"].includes(
          previousStatus,
        )
      ) {
        await admin
          .from("billing_webhook_events")
          .update({
            processing_status: "ignored",
            error_message: "Stale out-of-order pending event ignored",
            processed_at: new Date().toISOString(),
          })
          .eq("provider_event_id", event.eventId);

        return NextResponse.json({
          received: true,
          stale: true,
          reason: "invalid_backwards_transition",
        });
      }

      // Paid activation & renewal MUST pass through centralized `activateVerifiedSubscriptionPayment`
      if (nextStatus === "active") {
        const isPlanChangeEvent =
          event.rawEventType === "subscription.plan_changed" ||
          (previousStatus === "active" &&
            previousPlanSlug !== "zero" &&
            previousPlanSlug !== targetPlanSlug);

        const effectiveAmount =
          event.amountMinor > 0 || isPlanChangeEvent
            ? event.amountMinor
            : planDef.priceMinor;

        const activation = await activateVerifiedSubscriptionPayment({
          admin,
          organizationId,
          subscriptionId: String(subRow.id),
          orderId: event.orderId || null,
          userId: event.userId || (subRow.user_id ? String(subRow.user_id) : null),
          planSlug: targetPlanSlug,
          productId: event.productId || null,
          providerSubscriptionId: event.providerSubscriptionId || null,
          providerPaymentId: event.providerPaymentId || null,
          providerEventId: event.eventId,
          amountMinor: effectiveAmount,
          currency: event.currency || "USD",
          currentPeriodStart: event.currentPeriodStart,
          currentPeriodEnd: event.currentPeriodEnd,
          cancelAtPeriodEnd: event.cancelAtPeriodEnd,
          isRenewal: event.rawEventType === "subscription.renewed",
          isPlanChange: isPlanChangeEvent,
          eventSource: "dodo_webhook",
        });

        if (!activation.ok) {
          await admin
            .from("billing_webhook_events")
            .update({
              processing_status: "failed",
              error_message: `${activation.code}: ${activation.message}`,
              processed_at: new Date().toISOString(),
            })
            .eq("provider_event_id", event.eventId);

          return jsonError(activation.status, activation.code, activation.message);
        }

        // Notify on plan tier change if upgraded/downgraded from an active paid plan
        if (
          previousStatus === "active" &&
          previousPlanSlug !== "zero" &&
          previousPlanSlug !== targetPlanSlug
        ) {
          const isUpgrade =
            comparePlanRank(targetPlanSlug, previousPlanSlug) > 0;
          const changeEvent = isUpgrade
            ? "billing.subscription.plan_upgraded"
            : "billing.subscription.plan_downgraded";

          await enqueueBillingNotification(admin, {
            organizationId,
            eventType: changeEvent,
            idempotencyKeyPrefix: `dodo:${event.eventId}:${changeEvent}`,
            payload: {
              eventType: changeEvent,
              organizationName,
              planName: planDef.name,
              previousPlanName: OFFICIAL_PLANS[previousPlanSlug].name,
              amountMinor: planDef.priceMinor,
              currency: "USD",
              effectiveDate: new Date().toISOString().slice(0, 10),
              includedBenefits: planDef.benefitGroups.flatMap((g) => g.items),
            },
          });
        }
      } else {
        const nowIso = new Date().toISOString();
        await admin
          .from("subscriptions")
          .update({
            plan: targetPlanSlug,
            status: nextStatus,
            billing_provider: "dodo",
            dodo_subscription_id:
              event.providerSubscriptionId || subRow.dodo_subscription_id,
            dodo_product_id: event.productId || subRow.dodo_product_id,
            price_minor: planDef.priceMinor,
            current_period_start:
              event.currentPeriodStart || subRow.current_period_start,
            current_period_end:
              event.currentPeriodEnd || subRow.current_period_end,
            cancel_at_period_end: Boolean(event.cancelAtPeriodEnd),
            cancelled_at: nextStatus === "canceled" ? nowIso : null,
            billing_recovery_deadline:
              nextStatus === "past_due"
                ? event.recoveryDeadline || subRow.billing_recovery_deadline
                : null,
            updated_at: nowIso,
          })
          .eq("id", subRow.id);

        if (nextStatus === "payment_failed" && event.orderId) {
          await admin
            .from("billing_orders")
            .update({
              status: "failed",
              payment_state: "payment_failed",
              updated_at: nowIso,
            })
            .eq("id", event.orderId);
        }

        if (nextStatus === "past_due" && previousStatus !== "past_due") {
          await enqueueBillingNotification(admin, {
            organizationId,
            eventType: "billing.subscription.past_due",
            idempotencyKeyPrefix: `dodo:${event.eventId}:past_due`,
            payload: {
              eventType: "billing.subscription.past_due",
              organizationName,
              planName: planDef.name,
              amountMinor: planDef.priceMinor,
              currency: "USD",
              recoveryDeadline: event.recoveryDeadline
                ? event.recoveryDeadline.slice(0, 10)
                : undefined,
            },
          });
        } else if (
          (nextStatus === "canceled" || nextStatus === "expired") &&
          !["canceled", "expired"].includes(previousStatus)
        ) {
          await enqueueBillingNotification(admin, {
            organizationId,
            eventType: "billing.subscription.canceled",
            idempotencyKeyPrefix: `dodo:${event.eventId}:canceled`,
            payload: {
              eventType: "billing.subscription.canceled",
              organizationName,
              planName: planDef.name,
              effectiveDate: nowIso.slice(0, 10),
            },
          });
        }
      }
    }

    // Case C: Payment Succeeded / Failed / Refunded / Disputed
    else if (event.normalizedKind === "payment.succeeded") {
      const effectiveAmount =
        event.amountMinor > 0 ? event.amountMinor : planDef.priceMinor;

      const activation = await activateVerifiedSubscriptionPayment({
        admin,
        organizationId,
        subscriptionId: String(subRow.id),
        orderId: event.orderId || null,
        userId: event.userId || (subRow.user_id ? String(subRow.user_id) : null),
        planSlug: targetPlanSlug,
        productId: event.productId || null,
        providerSubscriptionId: event.providerSubscriptionId || null,
        providerPaymentId: event.providerPaymentId || null,
        providerEventId: event.eventId,
        amountMinor: effectiveAmount,
        currency: event.currency || "USD",
        currentPeriodStart: event.currentPeriodStart,
        currentPeriodEnd: event.currentPeriodEnd,
        eventSource: "dodo_webhook",
      });

      if (!activation.ok) {
        await admin
          .from("billing_webhook_events")
          .update({
            processing_status: "failed",
            error_message: `${activation.code}: ${activation.message}`,
            processed_at: new Date().toISOString(),
          })
          .eq("provider_event_id", event.eventId);

        return jsonError(activation.status, activation.code, activation.message);
      }
    } else if (
      event.normalizedKind === "payment.failed" ||
      event.normalizedKind === "payment.refunded" ||
      event.normalizedKind === "payment.disputed"
    ) {
      const nowIso = new Date().toISOString();
      const paymentStatus =
        event.normalizedKind === "payment.failed"
          ? "failed"
          : event.normalizedKind === "payment.refunded"
            ? "refunded"
            : "disputed";
      const nextPaymentState: PaymentLifecycleState =
        event.normalizedKind === "payment.failed"
          ? "payment_failed"
          : event.normalizedKind === "payment.refunded"
            ? "refunded"
            : "disputed";

      if (event.providerPaymentId) {
        await admin.from("billing_payments").upsert(
          {
            organization_id: organizationId,
            subscription_id: String(subRow.id),
            order_id: event.orderId || null,
            provider: "dodo",
            provider_payment_id: event.providerPaymentId,
            amount_minor: event.amountMinor || planDef.priceMinor,
            refunded_amount_minor:
              event.normalizedKind === "payment.refunded"
                ? event.refundAmountMinor || event.amountMinor || planDef.priceMinor
                : 0,
            currency: event.currency || "USD",
            status: paymentStatus,
            payment_state: nextPaymentState,
            payment_type: "subscription",
            refunded_at: paymentStatus === "refunded" ? nowIso : null,
            updated_at: nowIso,
          },
          { onConflict: "provider_payment_id" },
        );

        // Update invoice status on refund or dispute
        if (paymentStatus === "refunded" || paymentStatus === "disputed") {
          const isPartialRefund =
            paymentStatus === "refunded" &&
            Boolean(event.refundAmountMinor) &&
            (event.refundAmountMinor || 0) < (event.amountMinor || planDef.priceMinor);

          await admin
            .from("billing_invoices")
            .update({
              status: isPartialRefund ? "partially_refunded" : paymentStatus,
              refunded_amount_minor:
                paymentStatus === "refunded"
                  ? event.refundAmountMinor || event.amountMinor || planDef.priceMinor
                  : 0,
              updated_at: nowIso,
            })
            .eq("provider_payment_id", event.providerPaymentId);
        }
      }

      if (event.orderId) {
        await admin
          .from("billing_orders")
          .update({
            status:
              paymentStatus === "failed"
                ? "failed"
                : paymentStatus,
            payment_state: nextPaymentState,
            updated_at: nowIso,
          })
          .eq("id", event.orderId);
      }

      // Phase 7 & 10: Failed initial payments never activate; full refunds or chargeback disputes revoke active paid access
      if (paymentStatus === "failed" && previousStatus === "pending") {
        await admin
          .from("subscriptions")
          .update({ status: "payment_failed", updated_at: nowIso })
          .eq("id", subRow.id);
      } else if (paymentStatus === "refunded" || paymentStatus === "disputed") {
        const isFullRefundOrDispute =
          paymentStatus === "disputed" ||
          !event.refundAmountMinor ||
          event.refundAmountMinor >= (event.amountMinor || planDef.priceMinor);

        if (isFullRefundOrDispute) {
          await admin
            .from("subscriptions")
            .update({
              status: paymentStatus === "disputed" ? "paused" : "expired",
              cancelled_at: nowIso,
              updated_at: nowIso,
            })
            .eq("id", subRow.id);
        }

        try {
          await admin.from("subscription_change_history").insert({
            organization_id: organizationId,
            subscription_id: String(subRow.id),
            change_type: paymentStatus,
            previous_plan: targetPlanSlug,
            new_plan: isFullRefundOrDispute ? "zero" : targetPlanSlug,
            previous_status: previousStatus,
            new_status: isFullRefundOrDispute
              ? paymentStatus === "disputed"
                ? "paused"
                : "expired"
              : previousStatus,
            amount_minor:
              event.refundAmountMinor || event.amountMinor || planDef.priceMinor,
            currency: event.currency || "USD",
            provider_event_id: event.eventId,
          });
        } catch {
          // Non-fatal
        }
      }

      await recordPaymentAuditEvent(admin, {
        organizationId,
        orderId: event.orderId || null,
        subscriptionId: String(subRow.id),
        previousState: null,
        newState: nextPaymentState,
        eventSource: "dodo_webhook",
        providerEventId: event.eventId,
        amountMinor:
          event.refundAmountMinor || event.amountMinor || planDef.priceMinor,
        currency: event.currency || "USD",
        reason: `Webhook event ${event.rawEventType}`,
      });

      const emailEventType =
        event.normalizedKind === "payment.failed"
          ? "billing.payment.failed"
          : event.normalizedKind === "payment.refunded"
            ? "billing.payment.refunded"
            : "billing.payment.dispute";

      const dedupRef = event.providerPaymentId || event.eventId;
      await enqueueBillingNotification(admin, {
        organizationId,
        eventType: emailEventType,
        idempotencyKeyPrefix: `payment:${emailEventType}:${dedupRef}`,
        payload: {
          eventType: emailEventType,
          organizationName,
          productName: "Asiyst AI",
          planName: planDef.name,
          amountMinor:
            event.normalizedKind === "payment.refunded"
              ? event.refundAmountMinor || event.amountMinor || planDef.priceMinor
              : event.amountMinor || planDef.priceMinor,
          currency: event.currency || "USD",
          transactionReference: event.providerPaymentId || event.eventId,
          refundStatus:
            event.normalizedKind === "payment.refunded" ? "Processed" : undefined,
        },
      });
    }

    await admin
      .from("billing_webhook_events")
      .update({
        processing_status: "processed",
        processed_at: new Date().toISOString(),
      })
      .eq("provider_event_id", event.eventId);

    const { entitlements } = await getOrganizationEffectiveEntitlements(
      admin,
      organizationId,
    );

    return NextResponse.json({
      received: true,
      eventId: event.eventId,
      kind: event.normalizedKind,
      organizationId,
      activePlan: entitlements.plan,
      isPaidActive: entitlements.isPaidActive,
      aiCreditsGranted: 0,
    });
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Webhook processing failure";
    await admin
      .from("billing_webhook_events")
      .update({
        processing_status: "failed",
        error_message: errorMsg,
        processed_at: new Date().toISOString(),
      })
      .eq("provider_event_id", event.eventId);

    return jsonError(
      500,
      "WEBHOOK_PROCESSING_FAILED",
      "Internal webhook processing error.",
    );
  }
}
