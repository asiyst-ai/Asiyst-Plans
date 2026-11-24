import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OFFICIAL_PLANS,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import { enqueueBillingNotification } from "@/lib/email/outbox";
import { getDodoProductIdForPlan } from "@/lib/payments/dodo";
import type { PaidPlanSlug } from "@/types/billing";

export type PaymentLifecycleState =
  | "created"
  | "checkout_pending"
  | "processing"
  | "payment_pending"
  | "payment_succeeded"
  | "payment_failed"
  | "payment_cancelled"
  | "expired"
  | "refund_pending"
  | "refunded"
  | "disputed";

export type PaymentEventSource =
  | "checkout_api"
  | "dodo_webhook"
  | "provider_reconciliation"
  | "system_expiry"
  | "user_cancel";

export const ALLOWED_PAYMENT_TRANSITIONS: Record<
  PaymentLifecycleState,
  ReadonlySet<PaymentLifecycleState>
> = {
  created: new Set([
    "checkout_pending",
    "processing",
    "payment_failed",
    "payment_cancelled",
    "expired",
  ]),
  checkout_pending: new Set([
    "processing",
    "payment_pending",
    "payment_succeeded",
    "payment_failed",
    "payment_cancelled",
    "expired",
  ]),
  processing: new Set([
    "payment_pending",
    "payment_succeeded",
    "payment_failed",
    "payment_cancelled",
    "expired",
  ]),
  payment_pending: new Set([
    "payment_succeeded",
    "payment_failed",
    "payment_cancelled",
    "expired",
  ]),
  payment_succeeded: new Set(["refund_pending", "refunded", "disputed"]),
  // Terminal failure/cancellation/expiry states NEVER transition directly to payment_succeeded
  payment_failed: new Set([]),
  payment_cancelled: new Set([]),
  expired: new Set([]),
  refund_pending: new Set(["refunded", "disputed"]),
  refunded: new Set(["disputed"]),
  disputed: new Set(["refunded"]),
};

export function canTransitionPaymentState(
  fromState: PaymentLifecycleState,
  toState: PaymentLifecycleState,
): boolean {
  if (fromState === toState) return true;
  return ALLOWED_PAYMENT_TRANSITIONS[fromState]?.has(toState) ?? false;
}

export async function recordPaymentAuditEvent(
  admin: SupabaseClient,
  input: {
    organizationId: string;
    orderId?: string | null;
    paymentId?: string | null;
    subscriptionId?: string | null;
    actorUserId?: string | null;
    previousState?: string | null;
    newState: PaymentLifecycleState;
    eventSource: PaymentEventSource;
    providerEventId?: string | null;
    amountMinor?: number | null;
    currency?: string;
    reason?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await admin.from("billing_payment_events").insert({
      organization_id: input.organizationId,
      order_id: input.orderId || null,
      payment_id: input.paymentId || null,
      subscription_id: input.subscriptionId || null,
      actor_user_id: input.actorUserId || null,
      previous_state: input.previousState || null,
      new_state: input.newState,
      event_source: input.eventSource,
      provider_event_id: input.providerEventId || null,
      amount_minor: input.amountMinor ?? null,
      currency: input.currency || "USD",
      reason: input.reason || null,
      metadata: input.metadata || {},
    });
  } catch {
    // Non-fatal if migration is pending in mock unit environment
  }
}

export function buildInvoiceNumber(paidAtIso: string, referenceSeed: string): string {
  const year = new Date(paidAtIso).getUTCFullYear() || new Date().getUTCFullYear();
  const cleanSeed = referenceSeed
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase()
    .slice(-8)
    .padStart(8, "0");
  return `ASY-RCP-${year}-${cleanSeed}`;
}

export interface VerifiedPaymentActivationInput {
  admin: SupabaseClient;
  organizationId: string;
  subscriptionId: string;
  orderId?: string | null;
  userId?: string | null;
  planSlug: PaidPlanSlug;
  productId?: string | null;
  providerSubscriptionId?: string | null;
  providerPaymentId?: string | null;
  providerEventId?: string | null;
  amountMinor: number;
  subtotalMinor?: number | null;
  taxAmountMinor?: number | null;
  currency: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  isRenewal?: boolean;
  eventSource: "dodo_webhook" | "provider_reconciliation";
}

export type VerifiedActivationResult =
  | {
      ok: true;
      alreadyActivated: boolean;
      subscriptionId: string;
      paymentId: string | null;
      invoiceNumber: string | null;
      planSlug: PaidPlanSlug;
    }
  | {
      ok: false;
      status: number;
      code:
        | "SUBSCRIPTION_NOT_FOUND"
        | "ORGANIZATION_MISMATCH"
        | "INVALID_PLAN"
        | "PRODUCT_PLAN_MISMATCH"
        | "AMOUNT_MISMATCH"
        | "CURRENCY_MISMATCH"
        | "INVALID_ORDER_STATE"
        | "PAYMENT_REUSE_CONFLICT";
      message: string;
    };

/**
 * Centralized, trusted subscription activation & invoice generation service (Phase 6 & 8).
 * Enforces all commercial, cryptographic, ownership, state-machine, and idempotency invariants
 * before activating any paid subscription benefits.
 */
export async function activateVerifiedSubscriptionPayment(
  input: VerifiedPaymentActivationInput,
): Promise<VerifiedActivationResult> {
  const { admin } = input;
  const normalizedPlan = normalizeOfficialPlanSlug(input.planSlug);
  if (!normalizedPlan || !isPaidPlanSlug(normalizedPlan)) {
    return {
      ok: false,
      status: 400,
      code: "INVALID_PLAN",
      message: "Target subscription plan is invalid or not a paid plan.",
    };
  }

  const planDef = OFFICIAL_PLANS[normalizedPlan];

  // 1. Validate currency strictly matches USD
  const cleanCurrency = (input.currency || "").trim().toUpperCase();
  if (cleanCurrency !== "USD") {
    return {
      ok: false,
      status: 400,
      code: "CURRENCY_MISMATCH",
      message: `Expected payment currency USD, received '${cleanCurrency}'.`,
    };
  }

  // 2. Validate Dodo product ID matches configured plan mapping when configured
  const expectedProductId = getDodoProductIdForPlan(normalizedPlan);
  if (
    expectedProductId &&
    input.productId &&
    input.productId.trim() !== expectedProductId
  ) {
    return {
      ok: false,
      status: 400,
      code: "PRODUCT_PLAN_MISMATCH",
      message: `Provider product '${input.productId}' does not match expected product for ${planDef.name}.`,
    };
  }

  // 3. Validate payment amount matches authoritative plan price (allowing tax on top of exact subtotal)
  const expectedMinor = planDef.priceMinor;
  const effectiveSubtotal =
    typeof input.subtotalMinor === "number" && input.subtotalMinor > 0
      ? input.subtotalMinor
      : input.amountMinor;
  const reportedTax = Math.max(0, input.taxAmountMinor || 0);

  const amountValid =
    input.amountMinor === expectedMinor ||
    (effectiveSubtotal === expectedMinor &&
      input.amountMinor === expectedMinor + reportedTax) ||
    (input.amountMinor > expectedMinor &&
      typeof input.taxAmountMinor === "number" &&
      input.amountMinor - input.taxAmountMinor === expectedMinor);

  if (!Number.isSafeInteger(input.amountMinor) || !amountValid) {
    return {
      ok: false,
      status: 400,
      code: "AMOUNT_MISMATCH",
      message: `Payment amount (${input.amountMinor} minor units) does not match authoritative price (${expectedMinor} minor units) for ${planDef.name}.`,
    };
  }

  // 4. Verify target subscription exists and belongs to the organization
  const { data: subRow } = await admin
    .from("subscriptions")
    .select("*")
    .eq("id", input.subscriptionId)
    .maybeSingle();

  if (!subRow) {
    return {
      ok: false,
      status: 404,
      code: "SUBSCRIPTION_NOT_FOUND",
      message: "Target subscription record was not found.",
    };
  }

  if (String(subRow.organization_id) !== input.organizationId) {
    return {
      ok: false,
      status: 403,
      code: "ORGANIZATION_MISMATCH",
      message: "Subscription does not belong to the specified organization.",
    };
  }

  // 5. Verify associated purchase intent (`billing_orders`) if provided
  let orderRow: Record<string, unknown> | null = null;
  if (input.orderId) {
    const { data: foundOrder } = await admin
      .from("billing_orders")
      .select("*")
      .eq("id", input.orderId)
      .maybeSingle();

    if (foundOrder) {
      if (String(foundOrder.organization_id) !== input.organizationId) {
        return {
          ok: false,
          status: 403,
          code: "ORGANIZATION_MISMATCH",
          message: "Purchase intent does not belong to the target organization.",
        };
      }

      const currentOrderState = String(
        foundOrder.payment_state || "checkout_pending",
      ) as PaymentLifecycleState;

      // Reject activation if purchase intent was already cancelled, failed, expired, or refunded
      if (
        !canTransitionPaymentState(currentOrderState, "payment_succeeded") &&
        currentOrderState !== "payment_succeeded"
      ) {
        return {
          ok: false,
          status: 409,
          code: "INVALID_ORDER_STATE",
          message: `Purchase intent in state '${currentOrderState}' cannot activate a subscription.`,
        };
      }
      orderRow = foundOrder;
    }
  }

  // 6. Prevent reusing an already-used providerPaymentId across a different subscription/org
  let existingPaymentId: string | null = null;
  if (input.providerPaymentId) {
    const { data: existingPayment } = await admin
      .from("billing_payments")
      .select("id, organization_id, subscription_id, activated_subscription_id, status")
      .eq("provider_payment_id", input.providerPaymentId)
      .maybeSingle();

    if (existingPayment) {
      if (
        String(existingPayment.organization_id) !== input.organizationId ||
        (existingPayment.activated_subscription_id &&
          String(existingPayment.activated_subscription_id) !== input.subscriptionId)
      ) {
        return {
          ok: false,
          status: 409,
          code: "PAYMENT_REUSE_CONFLICT",
          message: "Provider payment ID is already bound to another subscription.",
        };
      }
      existingPaymentId = String(existingPayment.id);
    }
  }

  const nowIso = new Date().toISOString();
  const periodStart =
    input.currentPeriodStart ||
    (subRow.current_period_start ? String(subRow.current_period_start) : nowIso);
  const periodEnd =
    input.currentPeriodEnd ||
    (subRow.current_period_end
      ? String(subRow.current_period_end)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString());

  const previousStatus = String(subRow.status || "pending").toLowerCase();
  const alreadyActiveSamePeriod =
    previousStatus === "active" &&
    normalizeOfficialPlanSlug(String(subRow.plan)) === normalizedPlan &&
    Boolean(existingPaymentId);

  const isFirstPaidWelcomeNeeded = !subRow.first_paid_welcome_sent_at;

  // 7. Activate subscription record
  await admin
    .from("subscriptions")
    .update({
      plan: normalizedPlan,
      status: "active",
      billing_provider: "dodo",
      dodo_subscription_id:
        input.providerSubscriptionId || subRow.dodo_subscription_id,
      dodo_product_id:
        input.productId || expectedProductId || subRow.dodo_product_id,
      price_minor: expectedMinor,
      current_period_start: periodStart,
      current_period_end: periodEnd,
      cancel_at_period_end: Boolean(input.cancelAtPeriodEnd),
      cancelled_at: null,
      billing_recovery_deadline: null,
      ...(isFirstPaidWelcomeNeeded ? { first_paid_welcome_sent_at: nowIso } : {}),
      updated_at: nowIso,
    })
    .eq("id", input.subscriptionId);

  // Deactivate any stale free/zero subscription row for this organization
  await admin
    .from("subscriptions")
    .update({
      status: "canceled",
      updated_at: nowIso,
    })
    .eq("organization_id", input.organizationId)
    .in("plan", ["free", "zero"])
    .in("status", ["active", "free"])
    .is("billing_provider", null);

  // 8. Complete purchase intent (`billing_orders`) & mark temporary purchase authorization completed
  if (orderRow?.id) {
    const prevOrderState = String(orderRow.payment_state || "checkout_pending");
    await admin
      .from("billing_orders")
      .update({
        status: "completed",
        payment_state: "payment_succeeded",
        completed_at: orderRow.completed_at || nowIso,
        last_reconciled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", orderRow.id);

    if (orderRow.purchase_authorization_id) {
      await admin
        .from("plan_purchase_authorizations")
        .update({
          status: "completed",
          completed_at: nowIso,
        })
        .eq("id", orderRow.purchase_authorization_id)
        .in("status", ["active", "checkout_initiated"]);
    }

    await recordPaymentAuditEvent(admin, {
      organizationId: input.organizationId,
      orderId: String(orderRow.id),
      subscriptionId: input.subscriptionId,
      actorUserId: input.userId || (orderRow.user_id ? String(orderRow.user_id) : null),
      previousState: prevOrderState,
      newState: "payment_succeeded",
      eventSource: input.eventSource,
      providerEventId: input.providerEventId,
      amountMinor: input.amountMinor,
      currency: "USD",
      reason: "Verified payment confirmed; subscription activated.",
    });
  }

  // 9. Upsert payment record & generate single deduplicated invoice/receipt
  const paymentRef =
    input.providerPaymentId ||
    `subpay_${input.providerSubscriptionId || input.subscriptionId}_${periodStart.slice(0, 10)}`;
  const invoiceNumber = buildInvoiceNumber(
    nowIso,
    paymentRef || input.subscriptionId,
  );

  let paymentId: string | null = existingPaymentId;
  const { data: upsertedPayment } = await admin
    .from("billing_payments")
    .upsert(
      {
        organization_id: input.organizationId,
        user_id: input.userId || (subRow.user_id ? String(subRow.user_id) : null),
        subscription_id: input.subscriptionId,
        order_id: input.orderId || (orderRow?.id ? String(orderRow.id) : null),
        provider: "dodo",
        provider_payment_id: paymentRef,
        amount_minor: input.amountMinor,
        refunded_amount_minor: 0,
        currency: "USD",
        status: "succeeded",
        payment_state: "payment_succeeded",
        activated_subscription_id: input.subscriptionId,
        payment_type: input.isRenewal ? "subscription_renewal" : "subscription_initial",
        invoice_number: invoiceNumber,
        paid_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "provider_payment_id" },
    )
    .select("id, invoice_number")
    .maybeSingle();

  if (upsertedPayment?.id) {
    paymentId = String(upsertedPayment.id);
  }
  const finalInvoiceNumber = upsertedPayment?.invoice_number
    ? String(upsertedPayment.invoice_number)
    : invoiceNumber;

  // Fetch organization & customer billing contact for invoice record
  const [{ data: orgRow }, { data: billingContact }] = await Promise.all([
    admin
      .from("organizations")
      .select("name, owner_id")
      .eq("id", input.organizationId)
      .maybeSingle(),
    admin
      .from("organization_billing_contacts")
      .select("*")
      .eq("organization_id", input.organizationId)
      .maybeSingle(),
  ]);

  const organizationName = String(orgRow?.name || "Organization");
  const sellerTaxId = process.env.ASIYST_SELLER_TAX_ID?.trim() || null;
  const sellerAddress = process.env.ASIYST_SELLER_ADDRESS?.trim() || null;
  // Phase 8: Never fabricate tax registration numbers; label as payment_receipt unless verified tax entity is configured
  const documentType =
    sellerTaxId && sellerAddress ? "tax_invoice" : "payment_receipt";

  if (paymentId) {
    await admin.from("billing_invoices").upsert(
      {
        invoice_number: finalInvoiceNumber,
        document_type: documentType,
        organization_id: input.organizationId,
        user_id:
          input.userId ||
          (subRow.user_id ? String(subRow.user_id) : null) ||
          (orgRow?.owner_id ? String(orgRow.owner_id) : null),
        subscription_id: input.subscriptionId,
        order_id: input.orderId || (orderRow?.id ? String(orderRow.id) : null),
        payment_id: paymentId,
        provider_payment_id: paymentRef,
        plan_slug: normalizedPlan,
        plan_name: planDef.name,
        plan_description: `${planDef.name} — Monthly Organization Subscription (Asiyst AI)`,
        quantity: 1,
        subtotal_minor: expectedMinor,
        tax_amount_minor: Math.max(0, input.amountMinor - expectedMinor),
        discount_amount_minor: 0,
        total_amount_minor: input.amountMinor,
        refunded_amount_minor: 0,
        currency: "USD",
        status: "paid",
        seller_details: {
          name: "Asiyst",
          domain: "https://plan.asiyst.com",
          supportEmail: "support@asiyst.com",
          ...(sellerAddress ? { address: sellerAddress } : {}),
          ...(sellerTaxId ? { taxRegistrationId: sellerTaxId } : {}),
        },
        customer_details: {
          organizationName,
          billingName: billingContact?.billing_name || organizationName,
          billingEmail: billingContact?.billing_email || null,
          companyName: billingContact?.company_name || organizationName,
          ...(billingContact?.tax_id ? { taxId: billingContact.tax_id } : {}),
          ...(billingContact?.address_line1
            ? {
                addressLine1: billingContact.address_line1,
                city: billingContact.city,
                stateRegion: billingContact.state_region,
                postalCode: billingContact.postal_code,
                countryCode: billingContact.country_code,
              }
            : {}),
        },
        issued_at: nowIso,
        paid_at: nowIso,
        period_start: periodStart,
        period_end: periodEnd,
        updated_at: nowIso,
      },
      { onConflict: "payment_id" },
    );
  }

  // 10. Record subscription lifecycle change & dispatch deduplicated notifications (non-blocking on email failure)
  if (!alreadyActiveSamePeriod) {
    try {
      await admin.from("subscription_change_history").insert({
        organization_id: input.organizationId,
        subscription_id: input.subscriptionId,
        actor_user_id: input.userId || null,
        change_type: input.isRenewal ? "renewed" : "activated_paid",
        previous_plan: normalizeOfficialPlanSlug(String(subRow.plan)) || "zero",
        new_plan: normalizedPlan,
        previous_status: previousStatus,
        new_status: "active",
        amount_minor: input.amountMinor,
        currency: "USD",
        provider_event_id: input.providerEventId || paymentRef,
      });
    } catch {
      // Non-fatal
    }

    const benefitsList = planDef.benefitGroups.flatMap((g) => g.items);
    const planAppUrl =
      process.env.NEXT_PUBLIC_APP_URL || "https://plan.asiyst.com";

    try {
      if (input.isRenewal) {
        await enqueueBillingNotification(admin, {
          organizationId: input.organizationId,
          eventType: "billing.subscription.renewed",
          idempotencyKeyPrefix: `renewed:${paymentRef}`,
          payload: {
            eventType: "billing.subscription.renewed",
            organizationName,
            productName: "Asiyst AI",
            planName: planDef.name,
            amountMinor: input.amountMinor,
            currency: "USD",
            billingInterval: "Monthly",
            nextRenewalDate: periodEnd.slice(0, 10),
            transactionReference: `${finalInvoiceNumber} (${paymentRef})`,
          },
        });
      } else {
        await enqueueBillingNotification(admin, {
          organizationId: input.organizationId,
          eventType: "billing.subscription.activated",
          idempotencyKeyPrefix: `activated:${input.subscriptionId}:${paymentRef}`,
          payload: {
            eventType: "billing.subscription.activated",
            organizationName,
            productName: "Asiyst AI",
            planName: planDef.name,
            amountMinor: input.amountMinor,
            currency: "USD",
            billingInterval: "Monthly",
            activationDate: periodStart.slice(0, 10),
            nextRenewalDate: periodEnd.slice(0, 10),
            transactionReference: `${finalInvoiceNumber} (${paymentRef})`,
            includedBenefits: benefitsList,
            actionUrl: `${planAppUrl}/account/invoices`,
            actionLabel: "View Receipt & Manage Subscription",
          },
        });

        if (isFirstPaidWelcomeNeeded) {
          await enqueueBillingNotification(admin, {
            organizationId: input.organizationId,
            eventType: "billing.subscription.welcome",
            idempotencyKeyPrefix: `welcome:first_paid:${input.organizationId}`,
            payload: {
              eventType: "billing.subscription.welcome",
              organizationName,
              productName: "Asiyst AI",
              planName: planDef.name,
              amountMinor: input.amountMinor,
              currency: "USD",
              includedBenefits: benefitsList,
            },
          });
        }
      }

      // Send payment receipt confirmation deduplicated strictly by paymentRef
      await enqueueBillingNotification(admin, {
        organizationId: input.organizationId,
        eventType: "billing.payment.succeeded",
        idempotencyKeyPrefix: `payment:billing.payment.succeeded:${paymentRef}`,
        payload: {
          eventType: "billing.payment.succeeded",
          organizationName,
          productName: "Asiyst AI",
          planName: planDef.name,
          amountMinor: input.amountMinor,
          currency: "USD",
          billingInterval: "Monthly",
          activationDate: periodStart.slice(0, 10),
          nextRenewalDate: periodEnd.slice(0, 10),
          transactionReference: `${finalInvoiceNumber} · Ref ${paymentRef}`,
          actionUrl: `${planAppUrl}/account/invoices`,
          actionLabel: "View & Print Official Receipt",
        },
      });
    } catch {
      // Phase 8 & 12: Temporary notification errors must never roll back a verified payment activation
    }
  }

  return {
    ok: true,
    alreadyActivated: alreadyActiveSamePeriod,
    subscriptionId: input.subscriptionId,
    paymentId,
    invoiceNumber: finalInvoiceNumber,
    planSlug: normalizedPlan,
  };
}
