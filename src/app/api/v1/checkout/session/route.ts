import { createHash, randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  OFFICIAL_PLANS,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import { isSubscriptionGrantingEntitlements } from "@/features/entitlements/engine";
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
import { reconcileOrderWithProvider } from "@/lib/payments/reconcile";
import { recordPaymentAuditEvent } from "@/lib/payments/state-machine";

// Strict schema: rejects forged price, discount, currency, duration, userId, or status fields!
const checkoutSchema = z
  .object({
    plan: z.string().min(1),
    organizationId: z.string().uuid().optional(),
    idempotencyKey: z.string().min(8).max(128).optional(),
  })
  .strict();

const CHECKOUT_MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes max checkout lifetime

export async function POST(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, 10, "checkout-session");
  if (rateLimited) return rateLimited;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = checkoutSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(
      400,
      "INVALID_CHECKOUT_REQUEST",
      "Invalid checkout request parameters. Client-supplied price, currency, discount, or status fields are strictly forbidden.",
    );
  }

  const planSlug = normalizeOfficialPlanSlug(parsed.data.plan);
  if (!planSlug) {
    return jsonError(
      400,
      "UNKNOWN_PLAN",
      "Selected plan does not exist in the Asiyst catalog.",
    );
  }

  // Enforce both authenticated identity AND valid short-lived 15-minute purchase authorization (Phase 3 & 4)
  const auth = await requireAuthenticatedUser(request, {
    requirePurchaseAuthorization: true,
    returnPath: `/checkout?plan=${encodeURIComponent(planSlug)}`,
    plan: planSlug,
  });
  if ("error" in auth) return auth.error;

  if (planSlug === "zero" || !isPaidPlanSlug(planSlug)) {
    return jsonError(
      400,
      "FREE_PLAN_NO_DODO_CHECKOUT",
      "Asiyst Zero is free ($0) and must not go through Dodo checkout. Use POST /api/v1/checkout/free-plan instead.",
    );
  }

  if (!auth.user.email || !auth.user.emailConfirmed) {
    return jsonError(
      400,
      "VERIFIED_EMAIL_REQUIRED",
      "A verified account email address is required before purchasing a subscription.",
    );
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    parsed.data.organizationId,
    true, // Owner or Billing Administrator required
  );
  if ("error" in orgAccess) return orgAccess.error;

  const planDef = OFFICIAL_PLANS[planSlug];
  const organizationId = orgAccess.organization.id;

  // 1. Verify plan & authoritative price against trusted subscription database (`billing_plans` + `billing_prices`)
  const { data: dbPlan } = await auth.admin
    .from("billing_plans")
    .select("id, product_id, status, is_free")
    .eq("slug", planSlug)
    .maybeSingle();

  if (dbPlan && (dbPlan.status !== "active" || dbPlan.is_free === true)) {
    return jsonError(
      400,
      "PLAN_NOT_PURCHASABLE",
      "The selected subscription plan is not currently active for paid purchase.",
    );
  }

  let authoritativePriceMinor = planDef.priceMinor;
  let dbPriceId: string | null = null;
  if (dbPlan?.id) {
    const { data: dbPrice } = await auth.admin
      .from("billing_prices")
      .select("id, amount_minor, currency, billing_interval, status")
      .eq("plan_id", dbPlan.id)
      .eq("currency", "USD")
      .eq("billing_interval", "month")
      .eq("status", "active")
      .limit(1)
      .maybeSingle();

    if (dbPrice) {
      if (
        Number(dbPrice.amount_minor) !== planDef.priceMinor ||
        dbPrice.currency !== "USD" ||
        dbPrice.billing_interval !== "month"
      ) {
        return jsonError(
          500,
          "CATALOG_PRICE_INTEGRITY_ERROR",
          "Database price configuration mismatch detected; checkout halted for safety.",
        );
      }
      authoritativePriceMinor = Number(dbPrice.amount_minor);
      dbPriceId = String(dbPrice.id);
    }
  }

  // 2. Check if organization already has an active paid subscription
  const { data: existingSubs } = await auth.admin
    .from("subscriptions")
    .select(
      "id, plan, status, current_period_end, billing_recovery_deadline, dodo_subscription_id",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  const activePaid = (existingSubs || []).find((s) => {
    const slug = normalizeOfficialPlanSlug(s.plan);
    return slug && slug !== "zero" && isSubscriptionGrantingEntitlements(s);
  });

  if (activePaid) {
    return jsonError(
      409,
      "ACTIVE_SUBSCRIPTION_EXISTS",
      "Your organization already has an active paid subscription. Use the upgrade or downgrade action from Manage Subscriptions instead of creating a duplicate subscription.",
      { existingSubscriptionId: activePaid.id, existingPlan: activePaid.plan },
    );
  }

  // 3. Reconcile & deduplicate any existing active/pending purchase intents for this organization (Phase 5 & 12)
  const headerIdempotencyKey = request.headers.get("idempotency-key")?.trim();
  const rawIdempotencySeed =
    headerIdempotencyKey ||
    parsed.data.idempotencyKey ||
    `${organizationId}:${planSlug}:${auth.purchaseAuthorization.id || "direct"}`;
  const normalizedIdempotencyKey = createHash("sha256")
    .update(`purchase_intent:${organizationId}:${rawIdempotencyKeySafe(rawIdempotencySeed)}`)
    .digest("hex");

  const { data: openOrders } = await auth.admin
    .from("billing_orders")
    .select("*")
    .eq("organization_id", organizationId)
    .in("status", ["pending", "processing"])
    .order("created_at", { ascending: false })
    .limit(5);

  const gateway = new AsiystDodoGateway();
  const nowMs = Date.now();

  for (const existingOrder of openOrders || []) {
    const existingOrderId = String(existingOrder.id);
    const existingOrderExp = existingOrder.expires_at
      ? Date.parse(String(existingOrder.expires_at))
      : Date.parse(String(existingOrder.created_at)) + CHECKOUT_MAX_LIFETIME_MS;
    const existingState = String(
      existingOrder.payment_state || "checkout_pending",
    );

    // If matching idempotency key or same plan with valid unexpired checkout URL, verify & reuse idempotently!
    if (
      (existingOrder.idempotency_key === normalizedIdempotencyKey ||
        existingOrder.plan_slug === planSlug) &&
      existingOrder.provider_checkout_url &&
      existingOrderExp > nowMs &&
      existingState === "checkout_pending"
    ) {
      return NextResponse.json({
        data: {
          orderId: existingOrderId,
          subscriptionId: existingOrder.subscription_id,
          plan: planDef.slug,
          amountMinor: authoritativePriceMinor,
          currency: "USD",
          checkoutUrl: String(existingOrder.provider_checkout_url),
          providerSessionId: existingOrder.provider_checkout_id || undefined,
          reusedExistingCheckout: true,
          benefitsActivated: false,
        },
      });
    }

    // Reconcile with Dodo Payments before deciding whether retry/replacement is safe
    const reconciled = await reconcileOrderWithProvider({
      admin: auth.admin,
      orderId: existingOrderId,
      gateway,
      nowMs,
    });

    if (reconciled.activated) {
      return NextResponse.json({
        data: {
          orderId: existingOrderId,
          subscriptionId: existingOrder.subscription_id,
          plan: existingOrder.plan_slug,
          amountMinor: existingOrder.total_amount_minor,
          currency: "USD",
          alreadyPaidAndActivated: true,
          invoiceNumber: reconciled.invoiceNumber,
          benefitsActivated: true,
        },
      });
    }

    if (
      existingState === "payment_pending" ||
      existingState === "processing"
    ) {
      return jsonError(
        409,
        "PAYMENT_VERIFICATION_IN_PROGRESS",
        "A previous payment for your organization is currently being verified with Dodo Payments. To prevent duplicate charges, please wait for verification before starting another payment.",
        { orderId: existingOrderId },
      );
    }

    // If user switched plans while an unstarted checkout_pending session was still open (and reconciled unpaid), cancel old intent cleanly
    if (!reconciled.retryAllowed && existingState === "checkout_pending") {
      const nowIsoCancel = new Date(nowMs).toISOString();
      await auth.admin
        .from("billing_orders")
        .update({
          status: "cancelled",
          payment_state: "payment_cancelled",
          cancelled_at: nowIsoCancel,
          updated_at: nowIsoCancel,
        })
        .eq("id", existingOrderId);

      if (existingOrder.subscription_id) {
        await auth.admin
          .from("subscriptions")
          .update({ status: "incomplete", updated_at: nowIsoCancel })
          .eq("id", existingOrder.subscription_id)
          .eq("status", "pending");
      }

      await recordPaymentAuditEvent(auth.admin, {
        organizationId,
        orderId: existingOrderId,
        subscriptionId: existingOrder.subscription_id
          ? String(existingOrder.subscription_id)
          : null,
        actorUserId: auth.user.id,
        previousState: "checkout_pending",
        newState: "payment_cancelled",
        eventSource: "user_cancel",
        reason: `Superseded by new plan selection (${planSlug}).`,
      });
    }
  }

  const dodoProductId = getDodoProductIdForPlan(planSlug);
  const subscriptionId = randomUUID();
  const orderId = randomUUID();
  const nowIso = new Date(nowMs).toISOString();
  const orderExpiresAt = new Date(nowMs + CHECKOUT_MAX_LIFETIME_MS).toISOString();

  // 4. Create pending subscription record — NEVER activates benefits until verified payment!
  const { error: subInsertError } = await auth.admin.from("subscriptions").insert({
    id: subscriptionId,
    user_id: auth.user.id,
    organization_id: organizationId,
    ...(dbPlan ? { plan_id: dbPlan.id, product_id: dbPlan.product_id } : {}),
    plan: planDef.slug,
    status: "pending",
    billing_provider: "dodo",
    billing_interval: "month",
    dodo_product_id: dodoProductId,
    price_minor: authoritativePriceMinor,
    cancel_at_period_end: false,
    entitlement_overrides: {},
  });

  if (subInsertError) {
    return jsonError(
      500,
      "SUBSCRIPTION_INIT_FAILED",
      "Unable to initialize pending subscription record.",
    );
  }

  // 5. Create purchase intent (`billing_orders`) protected by unique active-org & idempotency constraints
  const { error: orderInsertError } = await auth.admin
    .from("billing_orders")
    .insert({
      id: orderId,
      organization_id: organizationId,
      user_id: auth.user.id,
      subscription_id: subscriptionId,
      plan_id: dbPlan?.id || null,
      price_id: dbPriceId,
      purchase_authorization_id: auth.purchaseAuthorization.id,
      idempotency_key: normalizedIdempotencyKey,
      plan_slug: planDef.slug,
      amount_minor: authoritativePriceMinor,
      tax_amount_minor: 0,
      discount_amount_minor: 0,
      total_amount_minor: authoritativePriceMinor,
      currency: "USD",
      status: "pending",
      payment_state: "created",
      provider: "dodo",
      expires_at: orderExpiresAt,
    });

  if (orderInsertError) {
    // Clean up orphaned pending subscription row on concurrent race (`23505`)
    await auth.admin
      .from("subscriptions")
      .update({ status: "incomplete", updated_at: nowIso })
      .eq("id", subscriptionId);

    if (orderInsertError.code === "23505") {
      const { data: winnerOrder } = await auth.admin
        .from("billing_orders")
        .select("*")
        .eq("organization_id", organizationId)
        .in("status", ["pending", "processing"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (winnerOrder?.provider_checkout_url) {
        return NextResponse.json({
          data: {
            orderId: winnerOrder.id,
            subscriptionId: winnerOrder.subscription_id,
            plan: winnerOrder.plan_slug,
            amountMinor: winnerOrder.total_amount_minor,
            currency: "USD",
            checkoutUrl: winnerOrder.provider_checkout_url,
            providerSessionId: winnerOrder.provider_checkout_id || undefined,
            reusedExistingCheckout: true,
            benefitsActivated: false,
          },
        });
      }

      return jsonError(
        409,
        "CONCURRENT_CHECKOUT_IN_PROGRESS",
        "A checkout request is already being processed for your organization. Please wait a moment.",
      );
    }

    return jsonError(
      500,
      "ORDER_INIT_FAILED",
      "Unable to create purchase intent record.",
    );
  }

  await recordPaymentAuditEvent(auth.admin, {
    organizationId,
    orderId,
    subscriptionId,
    actorUserId: auth.user.id,
    previousState: null,
    newState: "created",
    eventSource: "checkout_api",
    amountMinor: authoritativePriceMinor,
    currency: "USD",
    reason: `Purchase intent created for ${planDef.name}.`,
  });

  if (!dodoProductId) {
    await auth.admin
      .from("subscriptions")
      .update({ status: "incomplete", updated_at: nowIso })
      .eq("id", subscriptionId);
    await auth.admin
      .from("billing_orders")
      .update({
        status: "failed",
        payment_state: "payment_failed",
        updated_at: nowIso,
      })
      .eq("id", orderId);

    return jsonError(
      503,
      "DODO_GATEWAY_PENDING_CONFIGURATION",
      `Purchase intent recorded (${orderId}), but Dodo Payments product mapping for ${planDef.name} is not configured. Paid benefits remain locked.`,
      {
        orderId,
        subscriptionId,
        plan: planDef.slug,
        amountMinor: authoritativePriceMinor,
        currency: "USD",
        benefitsActivated: false,
      },
    );
  }

  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL ||
    request.nextUrl.origin ||
    "https://plan.asiyst.com";
  const successUrl = `${appOrigin}/checkout?plan=${planDef.slug}&checkout=return&orderId=${orderId}`;
  const cancelUrl = `${appOrigin}/checkout?plan=${planDef.slug}&checkout=cancelled&orderId=${orderId}`;

  const checkout = await gateway.createSubscriptionCheckout({
    organizationId,
    subscriptionId,
    orderId,
    planSlug,
    productId: dodoProductId,
    expectedPriceMinor: authoritativePriceMinor,
    userId: auth.user.id,
    userEmail: auth.user.email,
    userName: auth.user.fullName,
    successUrl,
    cancelUrl,
    idempotencyKey: normalizedIdempotencyKey,
  });

  if (!checkout.ok || !checkout.checkoutUrl) {
    await auth.admin
      .from("subscriptions")
      .update({ status: "incomplete", updated_at: nowIso })
      .eq("id", subscriptionId);

    await auth.admin
      .from("billing_orders")
      .update({
        status: "failed",
        payment_state: "payment_failed",
        updated_at: nowIso,
      })
      .eq("id", orderId);

    await recordPaymentAuditEvent(auth.admin, {
      organizationId,
      orderId,
      subscriptionId,
      actorUserId: auth.user.id,
      previousState: "created",
      newState: "payment_failed",
      eventSource: "checkout_api",
      amountMinor: authoritativePriceMinor,
      currency: "USD",
      reason: checkout.errorCode || "CHECKOUT_CREATION_FAILED",
    });

    return jsonError(
      503,
      checkout.errorCode || "CHECKOUT_CREATION_FAILED",
      "Unable to start Dodo Payments checkout session right now. No charge was made.",
      {
        orderId,
        subscriptionId,
        benefitsActivated: false,
      },
    );
  }

  // Transition purchase intent to `checkout_pending` and mark purchase authorization `checkout_initiated`
  await auth.admin
    .from("billing_orders")
    .update({
      payment_state: "checkout_pending",
      provider_checkout_id: checkout.providerSessionId || null,
      provider_checkout_url: checkout.checkoutUrl,
      updated_at: nowIso,
    })
    .eq("id", orderId);

  if (auth.purchaseAuthorization.id) {
    await auth.admin
      .from("plan_purchase_authorizations")
      .update({
        status: "checkout_initiated",
        intended_plan: planDef.slug,
        last_verified_at: nowIso,
      })
      .eq("id", auth.purchaseAuthorization.id)
      .eq("status", "active");
  }

  try {
    await auth.admin.from("subscription_change_history").insert({
      organization_id: organizationId,
      subscription_id: subscriptionId,
      actor_user_id: auth.user.id,
      change_type: "checkout_created",
      previous_plan: "zero",
      new_plan: planDef.slug,
      previous_status: "free",
      new_status: "pending",
      amount_minor: authoritativePriceMinor,
      currency: "USD",
      metadata: { order_id: orderId },
    });
  } catch {
    // Non-fatal
  }

  await recordPaymentAuditEvent(auth.admin, {
    organizationId,
    orderId,
    subscriptionId,
    actorUserId: auth.user.id,
    previousState: "created",
    newState: "checkout_pending",
    eventSource: "checkout_api",
    amountMinor: authoritativePriceMinor,
    currency: "USD",
    reason: "Dodo Payments hosted checkout session initialized.",
    metadata: { providerSessionId: checkout.providerSessionId || null },
  });

  return NextResponse.json({
    data: {
      orderId,
      subscriptionId,
      plan: planDef.slug,
      amountMinor: authoritativePriceMinor,
      currency: "USD",
      checkoutUrl: checkout.checkoutUrl,
      providerSessionId: checkout.providerSessionId,
      expiresAt: orderExpiresAt,
      reusedExistingCheckout: false,
      benefitsActivated: false, // Strictly activated ONLY after verified payment confirmation
    },
  });
}

function rawIdempotencyKeySafe(raw: string): string {
  return raw.trim().slice(0, 200);
}
