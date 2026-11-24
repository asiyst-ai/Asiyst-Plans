import { randomUUID } from "node:crypto";
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

const checkoutSchema = z.object({
  plan: z.string().min(1),
  organizationId: z.string().uuid().optional(),
});

export async function POST(request: NextRequest) {
  const rateLimited = enforceRateLimit(request, 8, "checkout-session");
  if (rateLimited) return rateLimited;

  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return jsonError(400, "INVALID_JSON", "Request body must be valid JSON.");
  }

  const parsed = checkoutSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_INPUT", "A valid subscription plan is required.");
  }

  const planSlug = normalizeOfficialPlanSlug(parsed.data.plan);
  if (!planSlug) {
    return jsonError(400, "UNKNOWN_PLAN", "Selected plan does not exist in the Asiyst catalog.");
  }

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
    true, // Requires Owner or Billing Administrator permission
  );
  if ("error" in orgAccess) return orgAccess.error;

  const planDef = OFFICIAL_PLANS[planSlug];
  const organizationId = orgAccess.organization.id;

  // Expire stale pending checkouts (>30 min old)
  const staleCutoff = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await auth.admin
    .from("subscriptions")
    .update({ status: "incomplete", updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("status", "pending")
    .is("dodo_subscription_id", null)
    .lt("created_at", staleCutoff);

  // Check if organization already has an active paid subscription
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
      "Your organization already has an active paid subscription. Use the upgrade or downgrade endpoint instead of creating a duplicate subscription.",
      { existingSubscriptionId: activePaid.id, existingPlan: activePaid.plan },
    );
  }

  const dodoProductId = getDodoProductIdForPlan(planSlug);
  const subscriptionId = randomUUID();
  const orderId = randomUUID();

  // Look up billing_plans and billing_products IDs if migration has been applied
  const { data: dbPlan } = await auth.admin
    .from("billing_plans")
    .select("id, product_id")
    .eq("slug", planSlug)
    .maybeSingle();

  // Create pending subscription record — DOES NOT activate benefits until webhook verifies payment!
  const { error: subInsertError } = await auth.admin.from("subscriptions").insert({
    id: subscriptionId,
    user_id: auth.user.id,
    organization_id: organizationId,
    ...(dbPlan ? { plan_id: dbPlan.id, product_id: dbPlan.product_id } : {}),
    plan: planDef.slug,
    status: "pending",
    billing_provider: "dodo",
    dodo_product_id: dodoProductId,
    price_minor: planDef.priceMinor,
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

  // Record internal order reference in billing_orders
  if (dbPlan?.id) {
    await auth.admin.from("billing_orders").insert({
      id: orderId,
      organization_id: organizationId,
      user_id: auth.user.id,
      subscription_id: subscriptionId,
      plan_id: dbPlan.id,
      plan_slug: planDef.slug,
      amount_minor: planDef.priceMinor,
      tax_amount_minor: 0,
      discount_amount_minor: 0,
      total_amount_minor: planDef.priceMinor,
      currency: "USD",
      status: "pending",
      provider: "dodo",
    });
  }

  if (!dodoProductId) {
    await auth.admin
      .from("subscriptions")
      .update({ status: "incomplete" })
      .eq("id", subscriptionId);

    return jsonError(
      503,
      "DODO_GATEWAY_PENDING_CONFIGURATION",
      `Order initialized (${orderId}), but Dodo Payments product mapping for ${planDef.name} is not configured yet. Paid benefits remain locked until Dodo checkout and webhook verification succeed.`,
      {
        orderId,
        subscriptionId,
        plan: planDef.slug,
        amountMinor: planDef.priceMinor,
        currency: "USD",
        benefitsActivated: false,
      },
    );
  }

  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin || "https://plan.asiyst.com";
  const successUrl = `${appOrigin}/account/subscriptions?checkout=return&orderId=${orderId}`;
  const cancelUrl = `${appOrigin}/checkout?plan=${planDef.slug}&checkout=cancelled&orderId=${orderId}`;

  const gateway = new AsiystDodoGateway();
  const checkout = await gateway.createSubscriptionCheckout({
    organizationId,
    subscriptionId,
    orderId,
    planSlug,
    productId: dodoProductId,
    expectedPriceMinor: planDef.priceMinor,
    userId: auth.user.id,
    userEmail: auth.user.email,
    userName: auth.user.fullName,
    successUrl,
    cancelUrl,
  });

  if (!checkout.ok || !checkout.checkoutUrl) {
    await auth.admin
      .from("subscriptions")
      .update({ status: "incomplete" })
      .eq("id", subscriptionId);

    await auth.admin
      .from("billing_orders")
      .update({ status: "failed" })
      .eq("id", orderId);

    return jsonError(
      503,
      checkout.errorCode || "CHECKOUT_CREATION_FAILED",
      checkout.error || "Unable to start Dodo Payments checkout session.",
      {
        orderId,
        subscriptionId,
        benefitsActivated: false,
      },
    );
  }

  await auth.admin
    .from("billing_orders")
    .update({
      provider_checkout_id: checkout.providerSessionId || null,
      provider_checkout_url: checkout.checkoutUrl,
    })
    .eq("id", orderId);

  return NextResponse.json({
    data: {
      orderId,
      subscriptionId,
      plan: planDef.slug,
      amountMinor: planDef.priceMinor,
      currency: "USD",
      checkoutUrl: checkout.checkoutUrl,
      providerSessionId: checkout.providerSessionId,
      benefitsActivated: false, // Strictly activated ONLY by verified Dodo webhook
    },
  });
}
