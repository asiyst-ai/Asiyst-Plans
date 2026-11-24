import { NextResponse, type NextRequest } from "next/server";
import {
  OFFICIAL_PLANS,
  comparePlanRank,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import { jsonError } from "@/lib/auth/session";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { AsiystDodoGateway } from "@/lib/payments/dodo";
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

    const { data: orgRow } = await admin
      .from("organizations")
      .select("name")
      .eq("id", organizationId)
      .maybeSingle();
    const organizationName = String(orgRow?.name || "Your Organization");

    const previousPlanSlug =
      normalizeOfficialPlanSlug(String(subRow.plan || "zero")) || "zero";
    const targetPlanSlug =
      event.planSlug ||
      normalizeOfficialPlanSlug(String(subRow.plan || "pulse")) ||
      "pulse";
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

    // Case B: Subscription Lifecycle Transition (Activation, Upgrade, Downgrade, Renewal, Cancellation, Past Due)
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

      // Guard against out-of-order backwards transition (active -> pending)
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

      const isFirstPaidWelcomeNeeded =
        nextStatus === "active" && !subRow.first_paid_welcome_sent_at;

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
            event.currentPeriodStart ||
            subRow.current_period_start ||
            new Date().toISOString(),
          current_period_end:
            event.currentPeriodEnd || subRow.current_period_end,
          cancel_at_period_end: Boolean(event.cancelAtPeriodEnd),
          cancelled_at:
            nextStatus === "canceled" ? new Date().toISOString() : null,
          billing_recovery_deadline:
            nextStatus === "past_due"
              ? event.recoveryDeadline || subRow.billing_recovery_deadline
              : null,
          ...(isFirstPaidWelcomeNeeded
            ? { first_paid_welcome_sent_at: new Date().toISOString() }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", subRow.id);

      // Deactivate any stale free/zero subscription row when paid subscription becomes active
      if (nextStatus === "active" || nextStatus === "trialing") {
        await admin
          .from("subscriptions")
          .update({
            status: "canceled",
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", organizationId)
          .in("plan", ["free", "zero"])
          .eq("status", "active")
          .is("billing_provider", null);

        if (event.orderId) {
          await admin
            .from("billing_orders")
            .update({
              status: "completed",
              updated_at: new Date().toISOString(),
            })
            .eq("id", event.orderId);
        }
      }

      // Queue appropriate lifecycle emails (Strictly NO AI Credits granted!)
      if (
        nextStatus === "active" &&
        !["active", "trialing"].includes(previousStatus)
      ) {
        const benefitsList = planDef.benefitGroups.flatMap((g) => g.items);

        await enqueueBillingNotification(admin, {
          organizationId,
          eventType: "billing.subscription.activated",
          idempotencyKeyPrefix: `dodo:${event.eventId}:activated`,
          payload: {
            eventType: "billing.subscription.activated",
            organizationName,
            productName: "Asiyst AI",
            planName: planDef.name,
            amountMinor: planDef.priceMinor,
            currency: "USD",
            billingInterval: "Monthly",
            activationDate: new Date().toISOString().slice(0, 10),
            nextRenewalDate: event.currentPeriodEnd
              ? event.currentPeriodEnd.slice(0, 10)
              : undefined,
            includedBenefits: benefitsList,
          },
        });

        // First paid welcome email sent strictly once per organization
        if (isFirstPaidWelcomeNeeded) {
          await enqueueBillingNotification(admin, {
            organizationId,
            eventType: "billing.subscription.welcome",
            idempotencyKeyPrefix: `welcome:first_paid:${organizationId}`,
            payload: {
              eventType: "billing.subscription.welcome",
              organizationName,
              productName: "Asiyst AI",
              planName: planDef.name,
              amountMinor: planDef.priceMinor,
              currency: "USD",
              includedBenefits: benefitsList,
            },
          });
        }
      } else if (
        nextStatus === "active" &&
        previousStatus === "active" &&
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
      } else if (
        nextStatus === "active" &&
        event.rawEventType === "subscription.renewed"
      ) {
        await enqueueBillingNotification(admin, {
          organizationId,
          eventType: "billing.subscription.renewed",
          idempotencyKeyPrefix: `dodo:${event.eventId}:renewed`,
          payload: {
            eventType: "billing.subscription.renewed",
            organizationName,
            planName: planDef.name,
            amountMinor: planDef.priceMinor,
            currency: "USD",
            billingInterval: "Monthly",
            nextRenewalDate: event.currentPeriodEnd
              ? event.currentPeriodEnd.slice(0, 10)
              : undefined,
          },
        });
      } else if (
        nextStatus === "past_due" &&
        previousStatus !== "past_due"
      ) {
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
            effectiveDate: new Date().toISOString().slice(0, 10),
          },
        });
      }
    }

    // Case C: Payment Succeeded / Failed / Refunded / Disputed
    else if (
      event.normalizedKind === "payment.succeeded" ||
      event.normalizedKind === "payment.failed" ||
      event.normalizedKind === "payment.refunded" ||
      event.normalizedKind === "payment.disputed"
    ) {
      const paymentStatus =
        event.normalizedKind === "payment.succeeded"
          ? "succeeded"
          : event.normalizedKind === "payment.failed"
            ? "failed"
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
            refunded_amount_minor: event.refundAmountMinor || 0,
            currency: event.currency || "USD",
            status: paymentStatus,
            payment_type: "subscription",
            paid_at:
              paymentStatus === "succeeded" ? new Date().toISOString() : null,
            refunded_at:
              paymentStatus === "refunded" ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "provider_payment_id" },
        );
      }

      const emailEventType =
        event.normalizedKind === "payment.succeeded"
          ? "billing.payment.succeeded"
          : event.normalizedKind === "payment.failed"
            ? "billing.payment.failed"
            : event.normalizedKind === "payment.refunded"
              ? "billing.payment.refunded"
              : "billing.payment.dispute";

      // Deduplicate receipts by providerPaymentId so payment.succeeded owns the receipt notification
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

    return jsonError(500, "WEBHOOK_PROCESSING_FAILED", "Internal webhook processing error.");
  }
}
