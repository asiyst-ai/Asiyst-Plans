import { createHmac, timingSafeEqual } from "node:crypto";
import DodoPayments from "dodopayments";
import {
  OFFICIAL_PLANS,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import type { PaidPlanSlug } from "@/types/billing";

export interface DodoMappingConfig {
  environment: "test_mode" | "live_mode";
  apiKeyConfigured: boolean;
  webhookSecretConfigured: boolean;
  products: Record<
    PaidPlanSlug,
    {
      productId: string | null;
      priceId: string | null;
      expectedAmountMinor: number;
      currency: "USD";
      isConfigured: boolean;
    }
  >;
  isFullyConfigured: boolean;
  missingVariables: string[];
}

export function getDodoConfigurationStatus(): DodoMappingConfig {
  const rawEnv = (
    process.env.DODO_PAYMENTS_ENVIRONMENT ||
    process.env.DODO_ENVIRONMENT ||
    "test_mode"
  )
    .trim()
    .toLowerCase();

  const apiKey = (
    process.env.DODO_PAYMENTS_API_KEY ||
    process.env.DODO_API_KEY ||
    ""
  ).trim();
  const webhookSecret = (
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET ||
    process.env.DODO_WEBHOOK_SECRET ||
    ""
  ).trim();

  const environment: "test_mode" | "live_mode" =
    rawEnv === "live_mode" || rawEnv === "production" || apiKey.startsWith("live_")
      ? "live_mode"
      : "test_mode";

  const pulseProduct =
    process.env.DODO_PRODUCT_ID_PULSE?.trim() ||
    process.env.DODO_PRODUCT_ID_STARTER?.trim() ||
    null;
  const pulsePrice = process.env.DODO_PRICE_ID_PULSE?.trim() || null;

  const vectorProduct =
    process.env.DODO_PRODUCT_ID_VECTOR?.trim() ||
    process.env.DODO_PRODUCT_ID_PRO?.trim() ||
    null;
  const vectorPrice = process.env.DODO_PRICE_ID_VECTOR?.trim() || null;

  const quantumProduct =
    process.env.DODO_PRODUCT_ID_QUANTUM?.trim() ||
    process.env.DODO_PRODUCT_ID_BUSINESS?.trim() ||
    null;
  const quantumPrice = process.env.DODO_PRICE_ID_QUANTUM?.trim() || null;

  // Ensure no two plans share the same Dodo product ID
  const nonNullProductIds = [pulseProduct, vectorProduct, quantumProduct].filter(
    (id): id is string => Boolean(id),
  );
  const hasDuplicateProductIds =
    new Set(nonNullProductIds).size !== nonNullProductIds.length;

  const missingVariables: string[] = [];
  if (!apiKey) missingVariables.push("DODO_PAYMENTS_API_KEY");
  if (!webhookSecret) missingVariables.push("DODO_PAYMENTS_WEBHOOK_SECRET");
  if (!pulseProduct) missingVariables.push("DODO_PRODUCT_ID_PULSE");
  if (!vectorProduct) missingVariables.push("DODO_PRODUCT_ID_VECTOR");
  if (!quantumProduct) missingVariables.push("DODO_PRODUCT_ID_QUANTUM");
  if (hasDuplicateProductIds) {
    missingVariables.push("UNIQUE_DODO_PRODUCT_IDS_REQUIRED");
  }

  return {
    environment,
    apiKeyConfigured: Boolean(apiKey),
    webhookSecretConfigured: Boolean(webhookSecret),
    products: {
      pulse: {
        productId: hasDuplicateProductIds ? null : pulseProduct,
        priceId: pulsePrice,
        expectedAmountMinor: OFFICIAL_PLANS.pulse.priceMinor,
        currency: "USD",
        isConfigured: Boolean(pulseProduct && !hasDuplicateProductIds),
      },
      vector: {
        productId: hasDuplicateProductIds ? null : vectorProduct,
        priceId: vectorPrice,
        expectedAmountMinor: OFFICIAL_PLANS.vector.priceMinor,
        currency: "USD",
        isConfigured: Boolean(vectorProduct && !hasDuplicateProductIds),
      },
      quantum: {
        productId: hasDuplicateProductIds ? null : quantumProduct,
        priceId: quantumPrice,
        expectedAmountMinor: OFFICIAL_PLANS.quantum.priceMinor,
        currency: "USD",
        isConfigured: Boolean(quantumProduct && !hasDuplicateProductIds),
      },
    },
    isFullyConfigured: missingVariables.length === 0,
    missingVariables,
  };
}

export function getDodoProductIdForPlan(planSlug: string): string | null {
  const normalized = normalizeOfficialPlanSlug(planSlug);
  if (!normalized || !isPaidPlanSlug(normalized)) return null;
  const status = getDodoConfigurationStatus();
  return status.products[normalized].productId;
}

export function getPlanForDodoProductId(productId: string): PaidPlanSlug | null {
  if (!productId) return null;
  const trimmed = productId.trim();
  const status = getDodoConfigurationStatus();
  for (const planSlug of ["pulse", "vector", "quantum"] as PaidPlanSlug[]) {
    if (status.products[planSlug].productId === trimmed) {
      return planSlug;
    }
  }
  return null;
}

export interface DodoSubscriptionCheckoutInput {
  organizationId: string;
  subscriptionId: string;
  orderId: string;
  planSlug: PaidPlanSlug;
  productId: string;
  expectedPriceMinor: number;
  userId: string;
  userEmail: string;
  userName?: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey?: string;
}

export interface DodoAuthoritativeStatus {
  ok: boolean;
  outcome:
    | "succeeded"
    | "pending"
    | "failed"
    | "cancelled"
    | "expired"
    | "unknown";
  providerSessionId?: string;
  providerSubscriptionId?: string;
  providerPaymentId?: string;
  productId?: string;
  amountMinor?: number;
  currency?: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  error?: string;
}

export interface DodoCheckoutResponse {
  ok: boolean;
  checkoutUrl?: string;
  providerSessionId?: string;
  errorCode?: string;
  error?: string;
}

export interface VerifiedDodoWebhookEvent {
  eventId: string;
  eventTimestamp: string;
  rawEventType: string;
  normalizedKind:
    | "subscription.lifecycle"
    | "subscription.recovered"
    | "payment.succeeded"
    | "payment.failed"
    | "payment.refunded"
    | "payment.disputed"
    | "ignored";
  providerSubscriptionId?: string;
  providerPaymentId?: string;
  productId?: string;
  planSlug?: PaidPlanSlug | null;
  subscriptionStatus?: string;
  currentPeriodStart?: string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  recoveryDeadline?: string | null;
  amountMinor: number;
  refundAmountMinor?: number;
  currency: string;
  organizationId?: string;
  subscriptionId?: string;
  orderId?: string;
  userId?: string;
  metadata: Record<string, unknown>;
}

export class AsiystDodoGateway {
  private getApiKey(): string {
    return (
      process.env.DODO_PAYMENTS_API_KEY ||
      process.env.DODO_API_KEY ||
      ""
    ).trim();
  }

  private getWebhookSecret(): string {
    return (
      process.env.DODO_PAYMENTS_WEBHOOK_SECRET ||
      process.env.DODO_WEBHOOK_SECRET ||
      ""
    ).trim();
  }

  private getClient(): DodoPayments {
    const config = getDodoConfigurationStatus();
    return new DodoPayments({
      bearerToken: this.getApiKey(),
      environment: config.environment,
    });
  }

  /**
   * Creates a verified Dodo-hosted checkout session for a paid plan (`pulse`, `vector`, `quantum`).
   * Validates the Dodo product price, currency, and recurring interval before creating checkout.
   */
  async createSubscriptionCheckout(
    input: DodoSubscriptionCheckoutInput,
  ): Promise<DodoCheckoutResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return {
        ok: false,
        errorCode: "DODO_GATEWAY_NOT_CONFIGURED",
        error:
          "Dodo Payments gateway is not configured yet. Configure DODO_PAYMENTS_API_KEY and product IDs when ready to process live/sandbox checkouts.",
      };
    }

    if (!input.productId) {
      return {
        ok: false,
        errorCode: "DODO_PRODUCT_NOT_MAPPED",
        error: `Dodo product ID for ${OFFICIAL_PLANS[input.planSlug].name} is not configured.`,
      };
    }

    try {
      const client = this.getClient();
      const product = await client.products.retrieve(input.productId);

      if (
        !product.is_recurring ||
        product.price.type !== "recurring_price" ||
        product.price.currency !== "USD" ||
        product.price.price !== input.expectedPriceMinor ||
        product.price.payment_frequency_interval.toLowerCase() !== "month" ||
        product.price.payment_frequency_count !== 1
      ) {
        return {
          ok: false,
          errorCode: "DODO_PRODUCT_PRICE_MISMATCH",
          error: `Configured Dodo product (${input.productId}) does not match the authoritative monthly price ($${(input.expectedPriceMinor / 100).toFixed(2)}/month USD) for ${OFFICIAL_PLANS[input.planSlug].name}.`,
        };
      }

      const session = await client.checkoutSessions.create(
        {
          product_cart: [{ product_id: input.productId, quantity: 1 }],
          customer: {
            email: input.userEmail,
            name:
              input.userName ||
              input.userEmail.split("@")[0] ||
              "Asiyst Customer",
          },
          billing_currency: "USD",
          feature_flags: {
            allow_currency_selection: false,
            allow_discount_code: false,
          },
          metadata: {
            organization_id: input.organizationId,
            subscription_id: input.subscriptionId,
            order_id: input.orderId,
            plan_id: input.planSlug,
            user_id: input.userId,
            type: "organization_subscription",
          },
          return_url: input.successUrl,
        },
        {
          idempotencyKey:
            input.idempotencyKey || `asiyst_checkout_${input.orderId}`,
        },
      );

      if (!session.checkout_url) {
        return {
          ok: false,
          errorCode: "DODO_CHECKOUT_URL_MISSING",
          error: "Dodo Payments did not return a hosted checkout URL.",
        };
      }

      return {
        ok: true,
        checkoutUrl: session.checkout_url,
        providerSessionId: String(session.session_id || ""),
      };
    } catch (err) {
      return {
        ok: false,
        errorCode: "DODO_API_ERROR",
        error:
          err instanceof Error
            ? err.message
            : "Unable to create Dodo Payments subscription checkout session.",
      };
    }
  }

  /**
   * Cancels or reactivates a subscription at the end of the current billing period.
   */
  async updateCancellationState(
    providerSubscriptionId: string,
    action: "cancel" | "reactivate",
  ): Promise<
    | { ok: true; cancelAtPeriodEnd: boolean }
    | { ok: false; errorCode: string; error: string }
  > {
    if (!this.getApiKey()) {
      return {
        ok: false,
        errorCode: "DODO_GATEWAY_NOT_CONFIGURED",
        error: "Dodo Payments API key is not configured.",
      };
    }

    try {
      const response = await this.getClient().subscriptions.update(
        providerSubscriptionId,
        action === "cancel"
          ? {
              cancel_at_next_billing_date: true,
              cancel_reason: "cancelled_by_customer",
            }
          : {
              cancel_at_next_billing_date: false,
            },
      );

      return {
        ok: true,
        cancelAtPeriodEnd: Boolean(response.cancel_at_next_billing_date),
      };
    } catch (err) {
      return {
        ok: false,
        errorCode: "DODO_SUBSCRIPTION_UPDATE_FAILED",
        error:
          err instanceof Error
            ? err.message
            : "Unable to update subscription cancellation status with Dodo Payments.",
      };
    }
  }

  /**
   * Changes the plan of an existing active Dodo subscription (upgrade or downgrade).
   */
  async changeSubscriptionPlan(
    providerSubscriptionId: string,
    targetProductId: string,
    prorationMode: "prorated_immediately" | "difference_immediately" = "prorated_immediately",
  ): Promise<{ ok: true } | { ok: false; errorCode: string; error: string }> {
    if (!this.getApiKey()) {
      return {
        ok: false,
        errorCode: "DODO_GATEWAY_NOT_CONFIGURED",
        error: "Dodo Payments API key is not configured.",
      };
    }

    try {
      await this.getClient().subscriptions.changePlan(providerSubscriptionId, {
        product_id: targetProductId,
        quantity: 1,
        proration_billing_mode: prorationMode,
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        errorCode: "DODO_PLAN_CHANGE_FAILED",
        error:
          err instanceof Error
            ? err.message
            : "Unable to change subscription plan with Dodo Payments.",
      };
    }
  }

  /**
   * Queries Dodo Payments server-to-server to reconcile uncertain or delayed
   * checkout/subscription/payment states (Phase 12 failure recovery).
   */
  async retrieveAuthoritativeStatus(input: {
    providerSessionId?: string | null;
    providerSubscriptionId?: string | null;
    providerPaymentId?: string | null;
  }): Promise<DodoAuthoritativeStatus> {
    if (!this.getApiKey()) {
      return {
        ok: false,
        outcome: "unknown",
        error: "Dodo Payments API key is not configured.",
      };
    }

    const client = this.getClient();

    try {
      let resolvedPaymentId = input.providerPaymentId?.trim() || "";
      let resolvedSubId = input.providerSubscriptionId?.trim() || "";
      let sessionStatus = "";

      if (input.providerSessionId?.trim()) {
        const sessionData = (await client.checkoutSessions.retrieve(
          input.providerSessionId.trim(),
        )) as unknown as Record<string, unknown>;

        sessionStatus = String(
          sessionData.payment_status || sessionData.status || "",
        ).toLowerCase();
        if (!resolvedPaymentId && typeof sessionData.payment_id === "string") {
          resolvedPaymentId = sessionData.payment_id;
        }
        if (
          !resolvedSubId &&
          typeof sessionData.subscription_id === "string"
        ) {
          resolvedSubId = sessionData.subscription_id;
        }
      }

      if (resolvedPaymentId) {
        const payment = (await client.payments.retrieve(
          resolvedPaymentId,
        )) as unknown as Record<string, unknown>;
        const pStatus = String(payment.status || "").toLowerCase();
        const subFromPay =
          typeof payment.subscription_id === "string"
            ? payment.subscription_id
            : resolvedSubId;

        let periodStart: string | null = null;
        let periodEnd: string | null = null;
        let productId: string | undefined;

        if (subFromPay) {
          try {
            const sub = (await client.subscriptions.retrieve(
              subFromPay,
            )) as unknown as Record<string, unknown>;
            periodStart = validIsoDate(sub.previous_billing_date);
            periodEnd = validIsoDate(sub.next_billing_date);
            if (typeof sub.product_id === "string") {
              productId = sub.product_id;
            }
          } catch {
            // Subscription details optional if payment already verified
          }
        }

        const totalAmount = Number(payment.total_amount ?? 0);
        const currency = String(payment.currency || "USD").toUpperCase();

        if (pStatus === "succeeded") {
          return {
            ok: true,
            outcome: "succeeded",
            providerSessionId: input.providerSessionId || undefined,
            providerSubscriptionId: subFromPay || undefined,
            providerPaymentId: resolvedPaymentId,
            productId,
            amountMinor: Number.isFinite(totalAmount)
              ? Math.round(totalAmount)
              : undefined,
            currency,
            currentPeriodStart: periodStart,
            currentPeriodEnd: periodEnd,
          };
        }

        if (pStatus === "failed") {
          return {
            ok: true,
            outcome: "failed",
            providerPaymentId: resolvedPaymentId,
          };
        }
        if (pStatus === "cancelled" || pStatus === "canceled") {
          return {
            ok: true,
            outcome: "cancelled",
            providerPaymentId: resolvedPaymentId,
          };
        }

        return {
          ok: true,
          outcome: "pending",
          providerPaymentId: resolvedPaymentId,
          providerSubscriptionId: subFromPay || undefined,
        };
      }

      if (resolvedSubId) {
        const sub = (await client.subscriptions.retrieve(
          resolvedSubId,
        )) as unknown as Record<string, unknown>;
        const sStatus = String(sub.status || "").toLowerCase();
        const totalAmount = Number(
          sub.recurring_pre_tax_amount ?? sub.total_amount ?? 0,
        );
        const currency = String(sub.currency || "USD").toUpperCase();

        if (sStatus === "active") {
          return {
            ok: true,
            outcome: "succeeded",
            providerSessionId: input.providerSessionId || undefined,
            providerSubscriptionId: resolvedSubId,
            productId:
              typeof sub.product_id === "string" ? sub.product_id : undefined,
            amountMinor: Number.isFinite(totalAmount)
              ? Math.round(totalAmount)
              : undefined,
            currency,
            currentPeriodStart: validIsoDate(sub.previous_billing_date),
            currentPeriodEnd: validIsoDate(sub.next_billing_date),
          };
        }

        if (sStatus === "failed") {
          return { ok: true, outcome: "failed" };
        }
        if (sStatus === "cancelled" || sStatus === "canceled") {
          return { ok: true, outcome: "cancelled" };
        }
        if (sStatus === "expired") {
          return { ok: true, outcome: "expired" };
        }

        return { ok: true, outcome: "pending", providerSubscriptionId: resolvedSubId };
      }

      if (sessionStatus === "expired") {
        return { ok: true, outcome: "expired" };
      }
      if (sessionStatus === "cancelled" || sessionStatus === "canceled") {
        return { ok: true, outcome: "cancelled" };
      }
      if (sessionStatus === "failed") {
        return { ok: true, outcome: "failed" };
      }

      return { ok: true, outcome: "pending" };
    } catch (err) {
      return {
        ok: false,
        outcome: "unknown",
        error:
          err instanceof Error
            ? err.message
            : "Unable to query Dodo Payments reconciliation status.",
      };
    }
  }

  /**
   * Verifies Standard Webhooks HMAC-SHA256 signature (`webhook-id`, `webhook-timestamp`, `webhook-signature`)
   * with +/- 300 second replay window tolerance and constant-time comparison.
   */
  verifyWebhookSignature(
    rawPayload: string,
    headers: {
      webhookId: string | null;
      webhookTimestamp: string | null;
      webhookSignature: string | null;
    },
  ):
    | { valid: true; event: VerifiedDodoWebhookEvent }
    | { valid: false; error: string } {
    const rawSecret = this.getWebhookSecret();
    if (!rawSecret) {
      return { valid: false, error: "Dodo webhook signing secret is not configured." };
    }

    const webhookId = headers.webhookId?.trim() || "";
    const webhookTimestamp = headers.webhookTimestamp?.trim() || "";
    const webhookSignature = headers.webhookSignature?.trim() || "";

    if (!webhookId || !webhookTimestamp || !webhookSignature) {
      return {
        valid: false,
        error: "Missing required webhook-id, webhook-timestamp, or webhook-signature headers.",
      };
    }

    if (!/^\d+$/.test(webhookTimestamp)) {
      return { valid: false, error: "Invalid webhook-timestamp format." };
    }

    const timestampSec = Number(webhookTimestamp);
    if (!Number.isSafeInteger(timestampSec)) {
      return { valid: false, error: "Invalid webhook-timestamp integer." };
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const ageSec = nowSec - timestampSec;
    if (ageSec > 300 || ageSec < -60) {
      return {
        valid: false,
        error: "Webhook timestamp is outside the 5-minute replay tolerance window.",
      };
    }

    let secretBuffer: Buffer;
    if (rawSecret.startsWith("whsec_")) {
      try {
        secretBuffer = Buffer.from(rawSecret.slice(6), "base64");
      } catch {
        secretBuffer = Buffer.from(rawSecret, "utf8");
      }
    } else {
      secretBuffer = Buffer.from(rawSecret, "utf8");
    }

    const signedContent = `${webhookId}.${webhookTimestamp}.${rawPayload}`;
    const expectedBase64 = createHmac("sha256", secretBuffer)
      .update(signedContent)
      .digest("base64");
    const expectedHex = createHmac("sha256", secretBuffer)
      .update(signedContent)
      .digest("hex");

    const candidates = webhookSignature.split(" ").map((part) => {
      const idx = part.indexOf(",");
      return idx >= 0 ? part.slice(idx + 1) : part;
    });

    let matched = false;
    for (const candidate of candidates) {
      if (
        candidate.length === expectedBase64.length &&
        timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedBase64))
      ) {
        matched = true;
        break;
      }
      if (
        candidate.length === expectedHex.length &&
        timingSafeEqual(Buffer.from(candidate), Buffer.from(expectedHex))
      ) {
        matched = true;
        break;
      }
    }

    if (!matched) {
      return { valid: false, error: "Invalid webhook cryptographic signature." };
    }

    try {
      const parsed = JSON.parse(rawPayload) as Record<string, unknown>;
      const rawEventType = String(parsed.type || parsed.event || "").toLowerCase();
      const data =
        parsed.data && typeof parsed.data === "object"
          ? (parsed.data as Record<string, unknown>)
          : parsed;
      const metadata =
        data.metadata && typeof data.metadata === "object"
          ? (data.metadata as Record<string, unknown>)
          : parsed.metadata && typeof parsed.metadata === "object"
            ? (parsed.metadata as Record<string, unknown>)
            : {};

      const providerSubscriptionId = String(
        data.subscription_id ||
          (rawEventType.startsWith("subscription.") ? data.id : "") ||
          "",
      ).trim();
      const providerPaymentId = String(
        data.payment_id ||
          (!rawEventType.startsWith("subscription.") ? data.id : "") ||
          "",
      ).trim();
      const productId = String(data.product_id || "").trim();
      const planFromProduct = getPlanForDodoProductId(productId);
      const planFromMetadata = normalizeOfficialPlanSlug(
        typeof metadata.plan_id === "string" ? metadata.plan_id : null,
      );
      const resolvedPlanSlug: PaidPlanSlug | null =
        planFromProduct ||
        (planFromMetadata && isPaidPlanSlug(planFromMetadata)
          ? planFromMetadata
          : null);

      const amountMinor = Number(
        data.total_amount ?? data.amount ?? parsed.total_amount ?? 0,
      );
      const refundAmountMinor = Number(
        data.refunded_amount ?? data.refund_amount ?? data.amount_refunded ?? 0,
      );
      const currency = String(data.currency || parsed.currency || "USD").toUpperCase();
      const eventTimestamp = new Date(timestampSec * 1000).toISOString();

      let normalizedKind: VerifiedDodoWebhookEvent["normalizedKind"] = "ignored";
      if (rawEventType === "dunning.recovered") {
        normalizedKind = "subscription.recovered";
      } else if (rawEventType.startsWith("subscription.")) {
        normalizedKind = "subscription.lifecycle";
      } else if (
        rawEventType === "payment.succeeded" ||
        rawEventType === "payment.paid" ||
        rawEventType === "order.paid"
      ) {
        normalizedKind = "payment.succeeded";
      } else if (
        rawEventType === "payment.failed" ||
        rawEventType === "payment.cancelled"
      ) {
        normalizedKind = "payment.failed";
      } else if (
        rawEventType === "payment.refunded" ||
        rawEventType === "refund.succeeded"
      ) {
        normalizedKind = "payment.refunded";
      } else if (
        rawEventType.startsWith("dispute.") ||
        rawEventType.includes("chargeback")
      ) {
        normalizedKind = "payment.disputed";
      }

      return {
        valid: true,
        event: {
          eventId: webhookId,
          eventTimestamp,
          rawEventType,
          normalizedKind,
          providerSubscriptionId: providerSubscriptionId || undefined,
          providerPaymentId: providerPaymentId || undefined,
          productId: productId || undefined,
          planSlug: resolvedPlanSlug,
          subscriptionStatus: String(
            data.status ||
              (rawEventType.startsWith("subscription.")
                ? rawEventType.slice("subscription.".length)
                : ""),
          ).toLowerCase(),
          currentPeriodStart: validIsoDate(data.previous_billing_date),
          currentPeriodEnd: validIsoDate(data.next_billing_date),
          cancelAtPeriodEnd: Boolean(data.cancel_at_next_billing_date),
          recoveryDeadline: validIsoDate(data.past_due_ends_at),
          amountMinor: Number.isFinite(amountMinor) ? Math.round(amountMinor) : 0,
          refundAmountMinor: Number.isFinite(refundAmountMinor)
            ? Math.round(refundAmountMinor)
            : 0,
          currency,
          organizationId:
            typeof metadata.organization_id === "string"
              ? metadata.organization_id
              : undefined,
          subscriptionId:
            typeof metadata.subscription_id === "string"
              ? metadata.subscription_id
              : undefined,
          orderId:
            typeof metadata.order_id === "string" ? metadata.order_id : undefined,
          userId:
            typeof metadata.user_id === "string" ? metadata.user_id : undefined,
          metadata,
        },
      };
    } catch (err) {
      return {
        valid: false,
        error:
          err instanceof Error
            ? `Invalid webhook JSON payload: ${err.message}`
            : "Invalid webhook JSON payload.",
      };
    }
  }
}

function validIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}
