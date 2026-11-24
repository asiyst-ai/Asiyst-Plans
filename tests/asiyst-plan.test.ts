import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it, beforeEach, afterEach } from "node:test";
import { NextRequest } from "next/server";
import {
  OFFICIAL_PLANS,
  OFFICIAL_PLAN_LIST,
  PLAN_COMPARISON_ROWS,
  comparePlanRank,
  formatMinorCurrency,
  isPaidPlanSlug,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import {
  computeEffectiveEntitlementsFromSubscription,
  evaluateEntitlementCheck,
  isSubscriptionGrantingEntitlements,
  selectAuthoritativeSubscription,
  type RawSubscriptionRow,
} from "@/features/entitlements/engine";
import {
  ESSENTIAL_BILLING_EMAIL_EVENTS,
  escapeHtml,
  isEssentialBillingEmail,
  renderBillingEmailTemplate,
} from "@/features/email-templates/templates";
import {
  AsiystDodoGateway,
  getDodoConfigurationStatus,
  getDodoProductIdForPlan,
  getPlanForDodoProductId,
} from "@/lib/payments/dodo";
import {
  computeRetryBackoffMs,
  enqueueBillingNotification,
  processSingleOutboxNotification,
} from "@/lib/email/outbox";
import {
  getServerSupabaseConfig,
  getSupabaseCookieOptions,
} from "@/lib/supabase/config";
import { setAdminClientForTesting } from "@/lib/supabase/admin";
import {
  enforceRateLimit,
  timingSafeSecretCompare,
} from "@/lib/auth/session";
import { POST as dodoWebhookPost } from "@/app/api/webhooks/dodo/route";
import { POST as emailWebhookPost } from "@/app/api/webhooks/email/route";
import { POST as workerEmailOutboxPost } from "@/app/api/v1/worker/email-outbox/route";
import { GET as entitlementsGet } from "@/app/api/v1/entitlements/route";
import { GET as productsGet } from "@/app/api/v1/products/route";
import { GET as authSessionGet } from "@/app/api/v1/auth/session/route";

function signStandardWebhook(
  secret: string,
  webhookId: string,
  timestampSec: number,
  rawPayload: string,
): string {
  const secretBuf = secret.startsWith("whsec_")
    ? Buffer.from(secret.slice(6), "base64")
    : Buffer.from(secret, "utf8");
  const signedContent = `${webhookId}.${timestampSec}.${rawPayload}`;
  const sig = createHmac("sha256", secretBuf)
    .update(signedContent)
    .digest("base64");
  return `v1,${sig}`;
}

describe("Asiyst Plan — Commercial Catalog & Pricing Invariants", () => {
  it("defines the exact 4 official plans with integer minor-unit USD pricing and 0 AI Credits", () => {
    assert.equal(OFFICIAL_PLAN_LIST.length, 4);

    assert.equal(OFFICIAL_PLANS.zero.priceMinor, 0);
    assert.equal(OFFICIAL_PLANS.zero.requiresDodoCheckout, false);
    assert.equal(OFFICIAL_PLANS.zero.aiCreditsIncluded, 0);

    assert.equal(OFFICIAL_PLANS.pulse.priceMinor, 2400);
    assert.equal(OFFICIAL_PLANS.pulse.requiresDodoCheckout, true);
    assert.equal(OFFICIAL_PLANS.pulse.aiCreditsIncluded, 0);

    assert.equal(OFFICIAL_PLANS.vector.priceMinor, 5400);
    assert.equal(OFFICIAL_PLANS.vector.requiresDodoCheckout, true);
    assert.equal(OFFICIAL_PLANS.vector.aiCreditsIncluded, 0);

    assert.equal(OFFICIAL_PLANS.quantum.priceMinor, 15400);
    assert.equal(OFFICIAL_PLANS.quantum.requiresDodoCheckout, true);
    assert.equal(OFFICIAL_PLANS.quantum.aiCreditsIncluded, 0);
  });

  it("normalizes canonical and legacy database plan slugs accurately", () => {
    assert.equal(normalizeOfficialPlanSlug("zero"), "zero");
    assert.equal(normalizeOfficialPlanSlug("free"), "zero");
    assert.equal(normalizeOfficialPlanSlug("PULSE"), "pulse");
    assert.equal(normalizeOfficialPlanSlug("starter"), "pulse");
    assert.equal(normalizeOfficialPlanSlug("vector"), "vector");
    assert.equal(normalizeOfficialPlanSlug("pro"), "vector");
    assert.equal(normalizeOfficialPlanSlug("quantum"), "quantum");
    assert.equal(normalizeOfficialPlanSlug("business"), "quantum");
    assert.equal(normalizeOfficialPlanSlug("unknown_tier"), null);

    assert.equal(isPaidPlanSlug("zero"), false);
    assert.equal(isPaidPlanSlug("pulse"), true);
    assert.equal(isPaidPlanSlug("vector"), true);
    assert.equal(isPaidPlanSlug("quantum"), true);

    assert.ok(comparePlanRank("quantum", "vector") > 0);
    assert.ok(comparePlanRank("pulse", "vector") < 0);
    assert.equal(comparePlanRank("zero", "zero"), 0);
  });

  it("formats integer minor units without floating-point errors", () => {
    assert.equal(formatMinorCurrency(0), "$0");
    assert.equal(formatMinorCurrency(2400), "$24");
    assert.equal(formatMinorCurrency(5400, "USD", true), "$54.00");
    assert.equal(formatMinorCurrency(15400), "$154");
    assert.throws(() => formatMinorCurrency(24.5), /integer in minor units/);
  });

  it("exposes complete comparison rows across all 4 official plans", () => {
    assert.ok(PLAN_COMPARISON_ROWS.length >= 15);
    const priceRow = PLAN_COMPARISON_ROWS.find((r) => r.key === "monthly_price");
    assert.ok(priceRow);
    assert.equal(priceRow.values.zero.display, "$0");
    assert.equal(priceRow.values.pulse.display, "$24");
    assert.equal(priceRow.values.vector.display, "$54");
    assert.equal(priceRow.values.quantum.display, "$154");
  });
});

describe("Asiyst Plan — Verified Payment Activation Gate & Entitlement Engine", () => {
  const nowMs = Date.parse("2026-11-24T10:00:00.000Z");
  const futureIso = "2026-12-24T10:00:00.000Z";
  const pastIso = "2026-10-24T10:00:00.000Z";

  it("never grants paid plan entitlements for pending, incomplete, payment_failed, paused, or expired subscriptions", () => {
    for (const nonGrantingStatus of [
      "pending",
      "incomplete",
      "payment_failed",
      "paused",
      "expired",
    ]) {
      const sub: RawSubscriptionRow = {
        id: "sub_unverified",
        organization_id: "org_1",
        plan: "vector",
        status: nonGrantingStatus,
        billing_provider: "dodo",
        dodo_subscription_id: null,
        dodo_product_id: "prod_vec",
        price_minor: 5400,
        current_period_start: null,
        current_period_end: futureIso,
        cancel_at_period_end: false,
        entitlement_overrides: null,
      };

      assert.equal(isSubscriptionGrantingEntitlements(sub, nowMs), false);
      const entitlements = computeEffectiveEntitlementsFromSubscription(
        "org_1",
        sub,
        nowMs,
      );
      // Must fall back strictly to Asiyst Zero ($0) limits
      assert.equal(entitlements.plan, "zero");
      assert.equal(entitlements.isPaidActive, false);
      assert.equal(entitlements.features.projects.limit, 1);
      assert.equal(entitlements.features.organization_seats.limit, 1);
      assert.equal(entitlements.features.knowledge_files.enabled, false);
      assert.equal(entitlements.features.avatar_studio.enabled, false);
      assert.equal(entitlements.aiCreditsIncluded, 0);
    }
  });

  it("unlocks exact paid plan quotas and features once verified active", () => {
    const quantumSub: RawSubscriptionRow = {
      id: "sub_quantum_active",
      organization_id: "org_quantum",
      plan: "quantum",
      status: "active",
      billing_provider: "dodo",
      dodo_subscription_id: "dodo_sub_123",
      dodo_product_id: "prod_quantum",
      price_minor: 15400,
      current_period_start: "2026-11-24T00:00:00.000Z",
      current_period_end: futureIso,
      cancel_at_period_end: false,
      entitlement_overrides: null,
    };

    const entitlements = computeEffectiveEntitlementsFromSubscription(
      "org_quantum",
      quantumSub,
      nowMs,
    );
    assert.equal(entitlements.plan, "quantum");
    assert.equal(entitlements.isPaidActive, true);
    assert.equal(entitlements.aiCreditsIncluded, 0);
    assert.equal(entitlements.features.projects.limit, 10);
    assert.equal(entitlements.features.organization_seats.limit, 10);
    assert.equal(entitlements.features.knowledge_files.unlimited, true);
    assert.equal(entitlements.features.knowledge_files.limit, null);
    assert.equal(entitlements.features.avatar_studio.enabled, true);
    assert.equal(entitlements.features.audit_history.enabled, true);
    assert.equal(entitlements.features.advanced_permissions.enabled, true);
  });

  it("preserves paid benefits during scheduled cancellation or past_due grace window and downgrades after expiry", () => {
    const canceledFuture: RawSubscriptionRow = {
      id: "sub_canceled_future",
      organization_id: "org_2",
      plan: "vector",
      status: "canceled",
      billing_provider: "dodo",
      dodo_subscription_id: "dodo_sub_2",
      dodo_product_id: "prod_vector",
      price_minor: 5400,
      current_period_start: "2026-11-01T00:00:00.000Z",
      current_period_end: futureIso,
      cancel_at_period_end: true,
      entitlement_overrides: null,
    };

    const activeEntitlements = computeEffectiveEntitlementsFromSubscription(
      "org_2",
      canceledFuture,
      nowMs,
    );
    assert.equal(activeEntitlements.plan, "vector");
    assert.equal(activeEntitlements.isPaidActive, true);
    assert.equal(activeEntitlements.features.projects.limit, 3);

    const canceledExpired: RawSubscriptionRow = {
      ...canceledFuture,
      current_period_end: pastIso,
    };
    const expiredEntitlements = computeEffectiveEntitlementsFromSubscription(
      "org_2",
      canceledExpired,
      nowMs,
    );
    assert.equal(expiredEntitlements.plan, "zero");
    assert.equal(expiredEntitlements.isPaidActive, false);
    assert.equal(expiredEntitlements.features.projects.limit, 1);
  });

  it("prioritizes verified active paid subscriptions over pending checkouts or free rows", () => {
    const pendingQuantum: RawSubscriptionRow = {
      id: "sub_pending",
      organization_id: "org_3",
      plan: "quantum",
      status: "pending",
      billing_provider: "dodo",
      dodo_subscription_id: null,
      dodo_product_id: "prod_q",
      price_minor: 15400,
      current_period_start: null,
      current_period_end: null,
      cancel_at_period_end: false,
      entitlement_overrides: null,
    };
    const activePulse: RawSubscriptionRow = {
      ...pendingQuantum,
      id: "sub_active_pulse",
      plan: "pulse",
      status: "active",
      dodo_subscription_id: "dodo_pulse_1",
      current_period_end: futureIso,
    };

    const chosen = selectAuthoritativeSubscription(
      [pendingQuantum, activePulse],
      nowMs,
    );
    assert.equal(chosen?.id, "sub_active_pulse");

    const checkAllowed = evaluateEntitlementCheck(
      computeEffectiveEntitlementsFromSubscription("org_3", chosen, nowMs),
      { featureKey: "knowledge_files", currentUsage: 4, requestedAmount: 1 },
    );
    assert.equal(checkAllowed.allowed, true);

    const checkDenied = evaluateEntitlementCheck(
      computeEffectiveEntitlementsFromSubscription("org_3", chosen, nowMs),
      { featureKey: "knowledge_files", currentUsage: 5, requestedAmount: 1 },
    );
    assert.equal(checkDenied.allowed, false);
  });
});

describe("Asiyst Plan — Dodo Payments Webhook Security & Signature Verification", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.DODO_PAYMENTS_ENVIRONMENT = "test_mode";
    process.env.DODO_PAYMENTS_API_KEY = "test_dodo_api_key_placeholder";
    process.env.DODO_PAYMENTS_WEBHOOK_SECRET =
      "whsec_dGVzdF9zZWNyZXRfa2V5X2Zvcl9unit_dGVzdHM=";
    process.env.DODO_PRODUCT_ID_PULSE = "pdt_pulse_2400";
    process.env.DODO_PRODUCT_ID_VECTOR = "pdt_vector_5400";
    process.env.DODO_PRODUCT_ID_QUANTUM = "pdt_quantum_15400";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setAdminClientForTesting(null);
  });

  it("detects duplicate Dodo product IDs and refuses misconfigured mappings", () => {
    assert.equal(getDodoConfigurationStatus().isFullyConfigured, true);
    assert.equal(getDodoProductIdForPlan("pulse"), "pdt_pulse_2400");
    assert.equal(getPlanForDodoProductId("pdt_vector_5400"), "vector");

    process.env.DODO_PRODUCT_ID_VECTOR = "pdt_pulse_2400"; // Duplicate!
    const status = getDodoConfigurationStatus();
    assert.equal(status.isFullyConfigured, false);
    assert.ok(status.missingVariables.includes("UNIQUE_DODO_PRODUCT_IDS_REQUIRED"));
    assert.equal(getDodoProductIdForPlan("pulse"), null);
  });

  it("verifies valid Standard Webhooks HMAC-SHA256 signatures and rejects forged or stale payloads", () => {
    const gateway = new AsiystDodoGateway();
    const secret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET!;
    const nowSec = Math.floor(Date.now() / 1000);
    const payload = JSON.stringify({
      type: "subscription.active",
      data: {
        subscription_id: "sub_dodo_999",
        product_id: "pdt_vector_5400",
        status: "active",
        total_amount: 5400,
        currency: "USD",
        previous_billing_date: "2026-11-24T00:00:00Z",
        next_billing_date: "2026-12-24T00:00:00Z",
        metadata: {
          organization_id: "11111111-1111-1111-1111-111111111111",
          subscription_id: "22222222-2222-2222-2222-222222222222",
          order_id: "33333333-3333-3333-3333-333333333333",
          plan_id: "vector",
        },
      },
    });

    const validSig = signStandardWebhook(secret, "msg_01", nowSec, payload);
    const verified = gateway.verifyWebhookSignature(payload, {
      webhookId: "msg_01",
      webhookTimestamp: String(nowSec),
      webhookSignature: validSig,
    });

    assert.equal(verified.valid, true);
    if (verified.valid) {
      assert.equal(verified.event.eventId, "msg_01");
      assert.equal(verified.event.normalizedKind, "subscription.lifecycle");
      assert.equal(verified.event.planSlug, "vector");
      assert.equal(verified.event.amountMinor, 5400);
      assert.equal(
        verified.event.organizationId,
        "11111111-1111-1111-1111-111111111111",
      );
    }

    // Forged signature must be rejected
    const forged = gateway.verifyWebhookSignature(payload, {
      webhookId: "msg_01",
      webhookTimestamp: String(nowSec),
      webhookSignature: "v1,invalidsignaturebase64==",
    });
    assert.equal(forged.valid, false);

    // Replay attack outside 300s window must be rejected
    const staleSec = nowSec - 600;
    const staleSig = signStandardWebhook(secret, "msg_02", staleSec, payload);
    const stale = gateway.verifyWebhookSignature(payload, {
      webhookId: "msg_02",
      webhookTimestamp: String(staleSec),
      webhookSignature: staleSig,
    });
    assert.equal(stale.valid, false);
  });

  it("processes Dodo webhook route idempotently and rejects invalid signatures with HTTP 401", async () => {
    const badReq = new NextRequest("https://plan.asiyst.com/api/webhooks/dodo", {
      method: "POST",
      headers: {
        "webhook-id": "msg_invalid",
        "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        "webhook-signature": "v1,forged",
      },
      body: JSON.stringify({ type: "subscription.active" }),
    });

    const badRes = await dodoWebhookPost(badReq);
    assert.equal(badRes.status, 401);

    // Mock admin client for duplicate event check
    const mockAdmin = {
      from(table: string) {
        if (table === "billing_webhook_events") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return {
                        data: { id: "evt_1", processing_status: "processed" },
                        error: null,
                      };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };
    setAdminClientForTesting(mockAdmin as never);

    const secret = process.env.DODO_PAYMENTS_WEBHOOK_SECRET!;
    const nowSec = Math.floor(Date.now() / 1000);
    const rawBody = JSON.stringify({
      type: "subscription.active",
      data: { subscription_id: "sub_1", product_id: "pdt_pulse_2400" },
    });
    const sig = signStandardWebhook(secret, "msg_dup_1", nowSec, rawBody);

    const dupReq = new NextRequest("https://plan.asiyst.com/api/webhooks/dodo", {
      method: "POST",
      headers: {
        "webhook-id": "msg_dup_1",
        "webhook-timestamp": String(nowSec),
        "webhook-signature": sig,
      },
      body: rawBody,
    });

    const dupRes = await dodoWebhookPost(dupReq);
    assert.equal(dupRes.status, 200);
    const dupJson = await dupRes.json();
    assert.equal(dupJson.duplicate, true);
  });
});

describe("Asiyst Plan — Transactional Email Templates, Outbox & Resend Webhook", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    setAdminClientForTesting(null);
  });

  it("escapes XSS payloads in organization and plan fields and generates both HTML and plain text", () => {
    const xssOrg = `<script>alert("xss")</script> & "Acme"`;
    const rendered = renderBillingEmailTemplate({
      eventType: "billing.subscription.activated",
      organizationName: xssOrg,
      planName: "Asiyst Vector",
      amountMinor: 5400,
      currency: "USD",
      includedBenefits: ["Up to 3 projects", "<b>Injected</b>"],
    });

    assert.ok(!rendered.html.includes("<script>"));
    assert.ok(rendered.html.includes("&lt;script&gt;"));
    assert.ok(rendered.html.includes("Asiyst Vector"));
    assert.ok(rendered.text.includes("ASIYST PLAN"));
    assert.ok(rendered.text.includes("$54.00 USD"));
    assert.equal(escapeHtml("O'Reilly & <Co>"), "O&#39;Reilly &amp; &lt;Co&gt;");
    assert.equal(
      isEssentialBillingEmail("billing.subscription.activated"),
      true,
    );
    assert.equal(
      isEssentialBillingEmail("billing.usage.limit_approaching"),
      false,
    );
    assert.ok(ESSENTIAL_BILLING_EMAIL_EVENTS.size >= 20);
  });

  it("schedules bounded retry backoff when RESEND_API_KEY is missing without losing outbox records", async () => {
    delete process.env.RESEND_API_KEY;
    const backoff1 = computeRetryBackoffMs(1);
    const backoff3 = computeRetryBackoffMs(3);
    assert.ok(backoff3 > backoff1);

    let updatedRecord: Record<string, unknown> | null = null;
    const mockAdmin = {
      from(table: string) {
        assert.equal(table, "notification_outbox");
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return {
                      data: {
                        id: "outbox_1",
                        organization_id: "org_1",
                        recipient_email: "owner@example.com",
                        event_type: "billing.payment.succeeded",
                        idempotency_key: "payment:1",
                        status: "pending",
                        attempt_count: 0,
                        payload: {
                          eventType: "billing.payment.succeeded",
                          organizationName: "Acme",
                          planName: "Asiyst Pulse",
                          amountMinor: 2400,
                        },
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
          update(values: Record<string, unknown>) {
            updatedRecord = values;
            return {
              eq() {
                return {
                  in() {
                    return {
                      select() {
                        return {
                          async maybeSingle() {
                            return { data: { id: "outbox_1" }, error: null };
                          },
                        };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    };

    const result = await processSingleOutboxNotification(
      mockAdmin as never,
      "outbox_1",
    );
    assert.equal(result.status, "retry_scheduled");
    assert.equal(updatedRecord?.["last_error_code"], "PROVIDER_NOT_CONFIGURED");
  });

  it("deduplicates notifications in enqueueBillingNotification and suppresses stale expiration reminders", async () => {
    const mockAdmin = {
      from(table: string) {
        if (table === "notification_outbox") {
          return {
            select() {
              return {
                eq() {
                  return {
                    async maybeSingle() {
                      return { data: { id: "existing_outbox_id" }, error: null };
                    },
                  };
                },
              };
            },
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    const res = await enqueueBillingNotification(mockAdmin as never, {
      organizationId: "org_1",
      eventType: "billing.payment.succeeded",
      idempotencyKeyPrefix: "payment:dup",
      payload: {
        eventType: "billing.payment.succeeded",
        organizationName: "Acme",
      },
      explicitRecipients: [
        { email: "owner@acme.com" },
        { email: "OWNER@acme.com" },
      ],
    });
    assert.equal(res.duplicateCount, 1);
    assert.equal(res.queuedIds.length, 0);
  });

  it("verifies Svix signatures on POST /api/webhooks/email and rejects unauthorized POST /api/v1/worker/email-outbox", async () => {
    process.env.EMAIL_WEBHOOK_SECRET = "whsec_dGVzdF9lbWFpbF9zZWNyZXQ=";
    const invalidEmailReq = new NextRequest(
      "https://plan.asiyst.com/api/webhooks/email",
      {
        method: "POST",
        headers: {
          "svix-id": "msg_1",
          "svix-timestamp": String(Math.floor(Date.now() / 1000)),
          "svix-signature": "v1,invalid",
        },
        body: JSON.stringify({ type: "email.delivered", data: { email_id: "em_1" } }),
      },
    );
    const invalidEmailRes = await emailWebhookPost(invalidEmailReq);
    assert.equal(invalidEmailRes.status, 401);

    process.env.CRON_SECRET = "super_secret_cron_token_123";
    const unauthWorkerReq = new NextRequest(
      "https://plan.asiyst.com/api/v1/worker/email-outbox",
      {
        method: "POST",
        headers: { Authorization: "Bearer wrong_token" },
      },
    );
    const unauthWorkerRes = await workerEmailOutboxPost(unauthWorkerReq);
    assert.equal(unauthWorkerRes.status, 401);
  });
});

describe("Asiyst Plan — Supabase Security, Cookie Domain & Cloudflare Runtime Guards", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    setAdminClientForTesting(null);
  });

  it("throws a hard security error if NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY is ever set", () => {
    process.env.NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY = "leaked_key";
    assert.throws(
      () => getServerSupabaseConfig("anon"),
      /SECURITY VIOLATION: NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/,
    );
  });

  it("resolves cross-subdomain cookie options safely when AUTH_COOKIE_DOMAIN is configured", () => {
    delete process.env.AUTH_COOKIE_DOMAIN;
    delete process.env.NEXT_PUBLIC_AUTH_COOKIE_DOMAIN;
    assert.equal(getSupabaseCookieOptions("plan.asiyst.com"), undefined);

    process.env.AUTH_COOKIE_DOMAIN = ".asiyst.com";
    const prodCookieOpts = getSupabaseCookieOptions("plan.asiyst.com");
    assert.deepEqual(prodCookieOpts, {
      domain: ".asiyst.com",
      path: "/",
      sameSite: "lax",
      secure: false,
    });

    // Must not apply .asiyst.com cookie domain when previewing on workers.dev or localhost
    assert.equal(
      getSupabaseCookieOptions("asiyst-plan-staging.workers.dev"),
      undefined,
    );
    assert.equal(getSupabaseCookieOptions("localhost:3001"), undefined);
  });

  it("enforces constant-time secret comparison and Cloudflare IP rate limiting", async () => {
    assert.equal(timingSafeSecretCompare("secret_a", "secret_a"), true);
    assert.equal(timingSafeSecretCompare("secret_a", "secret_b"), false);
    assert.equal(timingSafeSecretCompare("", "secret_a"), false);

    const makeReq = () =>
      new NextRequest("https://plan.asiyst.com/api/v1/checkout/session", {
        method: "POST",
        headers: { "cf-connecting-ip": "203.0.113.42" },
      });

    assert.equal(enforceRateLimit(makeReq(), 2, "unit-test-scope"), null);
    assert.equal(enforceRateLimit(makeReq(), 2, "unit-test-scope"), null);
    const blocked = enforceRateLimit(makeReq(), 2, "unit-test-scope");
    assert.equal(blocked?.status, 429);
  });

  it("serves public catalog, session check, and internal secret-authenticated entitlement lookups", async () => {
    const prodRes = await productsGet();
    assert.equal(prodRes.status, 200);
    const prodJson = await prodRes.json();
    assert.equal(prodJson.data.products[0].slug, "asiyst-ai");

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const sessReq = new NextRequest(
      "https://plan.asiyst.com/api/v1/auth/session",
    );
    const sessRes = await authSessionGet(sessReq);
    assert.equal(sessRes.status, 200);
    const sessJson = await sessRes.json();
    assert.equal(sessJson.data.authenticated, false);

    // Internal entitlement lookup with ASIYST_INTERNAL_SECRET
    process.env.ASIYST_INTERNAL_SECRET = "shared_internal_secret_xyz";
    const mockAdmin = {
      from(table: string) {
        assert.equal(table, "subscriptions");
        return {
          select() {
            return {
              eq() {
                return {
                  async order() {
                    return {
                      data: [
                        {
                          id: "sub_pulse_1",
                          organization_id: "org_internal_1",
                          plan: "pulse",
                          status: "active",
                          billing_provider: "dodo",
                          dodo_subscription_id: "dodo_1",
                          dodo_product_id: "pdt_pulse",
                          price_minor: 2400,
                          current_period_start: "2026-11-01T00:00:00Z",
                          current_period_end: "2099-12-01T00:00:00Z",
                          cancel_at_period_end: false,
                          entitlement_overrides: null,
                        },
                      ],
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      },
    };
    setAdminClientForTesting(mockAdmin as never);

    const entReq = new NextRequest(
      "https://plan.asiyst.com/api/v1/entitlements?organizationId=org_internal_1",
      {
        headers: { "x-asiyst-internal-secret": "shared_internal_secret_xyz" },
      },
    );
    const entRes = await entitlementsGet(entReq);
    assert.equal(entRes.status, 200);
    const entJson = await entRes.json();
    assert.equal(entJson.data.entitlements.plan, "pulse");
    assert.equal(entJson.data.entitlements.isPaidActive, true);
    assert.equal(entJson.data.entitlements.aiCreditsIncluded, 0);
  });
});
