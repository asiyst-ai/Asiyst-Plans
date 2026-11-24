import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getOrganizationEffectiveEntitlements } from "@/features/entitlements/engine";
import {
  enforceRateLimit,
  jsonError,
  requireAuthenticatedUser,
  resolveUserOrganizationAccess,
} from "@/lib/auth/session";
import { clearPlanPurchaseCookieOnly } from "@/lib/auth/sso";
import { reconcileOrderWithProvider } from "@/lib/payments/reconcile";
import {
  canTransitionPaymentState,
  recordPaymentAuditEvent,
  type PaymentLifecycleState,
} from "@/lib/payments/state-machine";

type Context = { params: Promise<{ id: string }> };

const actionSchema = z
  .object({
    action: z.enum(["reconcile", "cancel"]),
    abandonPurchaseSession: z.boolean().optional(),
  })
  .strict();

export async function GET(request: NextRequest, context: Context) {
  const auth = await requireAuthenticatedUser(request);
  if ("error" in auth) return auth.error;

  const { id } = await context.params;

  const { data: initialOrder, error } = await auth.admin
    .from("billing_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error || !initialOrder) {
    return jsonError(404, "ORDER_NOT_FOUND", "Checkout order not found.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    String(initialOrder.organization_id),
    false,
  );
  if ("error" in orgAccess) return orgAccess.error;

  // Automatically reconcile pending orders if requested or if last check > 10s ago
  const shouldReconcile =
    request.nextUrl.searchParams.get("reconcile") === "1" ||
    initialOrder.status === "pending";
  const lastRecMs = initialOrder.last_reconciled_at
    ? Date.parse(String(initialOrder.last_reconciled_at))
    : 0;

  let reconciliation = null;
  if (
    shouldReconcile &&
    initialOrder.status !== "completed" &&
    Date.now() - lastRecMs > 8_000
  ) {
    reconciliation = await reconcileOrderWithProvider({
      admin: auth.admin,
      orderId: id,
    });
  }

  const [{ data: order }, { entitlements, rawSubscription }, { data: invoice }] =
    await Promise.all([
      auth.admin.from("billing_orders").select("*").eq("id", id).maybeSingle(),
      getOrganizationEffectiveEntitlements(
        auth.admin,
        String(initialOrder.organization_id),
      ),
      auth.admin
        .from("billing_invoices")
        .select("*")
        .eq("order_id", id)
        .maybeSingle(),
    ]);

  const effectiveOrder = order || initialOrder;
  const paymentState = String(
    effectiveOrder.payment_state ||
      (effectiveOrder.status === "completed"
        ? "payment_succeeded"
        : "checkout_pending"),
  );

  const isPaymentVerifiedAndActive =
    paymentState === "payment_succeeded" &&
    entitlements.isPaidActive &&
    entitlements.subscriptionId === effectiveOrder.subscription_id;

  return NextResponse.json({
    data: {
      order: effectiveOrder,
      paymentState,
      subscription: rawSubscription,
      entitlements,
      invoice: invoice || null,
      reconciliation,
      retryAllowed:
        paymentState === "payment_failed" ||
        paymentState === "payment_cancelled" ||
        paymentState === "expired",
      isPaymentVerifiedAndActive,
    },
  });
}

export async function POST(request: NextRequest, context: Context) {
  const rateLimited = enforceRateLimit(request, 12, "checkout-order-action");
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

  const parsed = actionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError(400, "INVALID_ACTION", "Action must be 'reconcile' or 'cancel'.");
  }

  const { data: order } = await auth.admin
    .from("billing_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!order) {
    return jsonError(404, "ORDER_NOT_FOUND", "Checkout order not found.");
  }

  const orgAccess = await resolveUserOrganizationAccess(
    auth.admin,
    auth.user.id,
    String(order.organization_id),
    true,
  );
  if ("error" in orgAccess) return orgAccess.error;

  // Always reconcile with Dodo Payments first so an already-paid order is never cancelled
  const reconciled = await reconcileOrderWithProvider({
    admin: auth.admin,
    orderId: id,
  });

  if (parsed.data.action === "reconcile" || reconciled.activated) {
    return NextResponse.json({
      data: reconciled,
    });
  }

  // Safe cancel when provider confirmed payment has not succeeded
  const currentState = reconciled.paymentState as PaymentLifecycleState;
  const nowIso = new Date().toISOString();

  if (
    currentState !== "payment_cancelled" &&
    canTransitionPaymentState(currentState, "payment_cancelled")
  ) {
    await auth.admin
      .from("billing_orders")
      .update({
        status: "cancelled",
        payment_state: "payment_cancelled",
        cancelled_at: nowIso,
        updated_at: nowIso,
      })
      .eq("id", id);

    if (order.subscription_id) {
      await auth.admin
        .from("subscriptions")
        .update({ status: "incomplete", updated_at: nowIso })
        .eq("id", order.subscription_id)
        .eq("status", "pending");
    }

    await recordPaymentAuditEvent(auth.admin, {
      organizationId: String(order.organization_id),
      orderId: id,
      subscriptionId: order.subscription_id ? String(order.subscription_id) : null,
      actorUserId: auth.user.id,
      previousState: currentState,
      newState: "payment_cancelled",
      eventSource: "user_cancel",
      reason: "User returned from cancelled checkout.",
    });
  }

  if (parsed.data.abandonPurchaseSession && order.purchase_authorization_id) {
    await auth.admin
      .from("plan_purchase_authorizations")
      .update({ status: "abandoned", abandoned_at: nowIso })
      .eq("id", order.purchase_authorization_id)
      .in("status", ["active", "checkout_initiated"]);
  }

  const response = NextResponse.json({
    data: {
      orderId: id,
      paymentState: "payment_cancelled",
      activated: false,
      retryAllowed: true,
      message: "Checkout session cancelled safely. No charges were made.",
    },
  });

  if (parsed.data.abandonPurchaseSession) {
    clearPlanPurchaseCookieOnly(response);
  }

  return response;
}
