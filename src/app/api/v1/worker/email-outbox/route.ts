import { NextResponse, type NextRequest } from "next/server";
import { OFFICIAL_PLANS, normalizeOfficialPlanSlug } from "@/features/catalog/plans";
import {
  jsonError,
  timingSafeSecretCompare,
} from "@/lib/auth/session";
import {
  enqueueBillingNotification,
  processNotificationOutboxBatch,
} from "@/lib/email/outbox";
import {
  createAdminClient,
  isSupabaseAdminConfigured,
} from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

function isAuthorizedWorker(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET?.trim();
  const internalSecret = process.env.ASIYST_EMAIL_INTERNAL_SECRET?.trim();
  const adminSecret = process.env.ADMIN_SECRET_KEY?.trim();

  const authHeader = request.headers.get("authorization") || "";
  const bearer = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const headerInternal = request.headers.get("x-asiyst-internal-secret")?.trim() || "";
  const headerAdmin = request.headers.get("x-admin-secret")?.trim() || "";

  return (
    (Boolean(cronSecret) && timingSafeSecretCompare(bearer, cronSecret)) ||
    (Boolean(internalSecret) &&
      (timingSafeSecretCompare(headerInternal, internalSecret) ||
        timingSafeSecretCompare(bearer, internalSecret))) ||
    (Boolean(adminSecret) &&
      (timingSafeSecretCompare(headerAdmin, adminSecret) ||
        timingSafeSecretCompare(bearer, adminSecret)))
  );
}

/**
 * Protected Internal Email & Scheduled Billing Reminder Worker:
 * 1. Revalidates and queues 7-day and 1-day subscription expiration reminders
 *    (only for subscriptions genuinely scheduled to expire with `cancel_at_period_end = true`).
 * 2. Revalidates and queues 1-day final payment warnings for `past_due` subscriptions.
 * 3. Recovers stale processing claims and dispatches pending/retry_scheduled outbox jobs.
 */
export async function POST(request: NextRequest) {
  if (!isAuthorizedWorker(request)) {
    return jsonError(
      401,
      "WORKER_UNAUTHORIZED",
      "Only authorized server-side workers may claim and process pending notifications.",
    );
  }

  if (!isSupabaseAdminConfigured()) {
    return jsonError(503, "SUPABASE_NOT_CONFIGURED", "Supabase admin is not configured.");
  }

  const admin = createAdminClient();
  let scheduledQueued = 0;

  // 1. Check expiring subscriptions (7 days and 1 day before current_period_end)
  const { data: cancelingSubs } = await admin
    .from("subscriptions")
    .select("id, organization_id, plan, status, cancel_at_period_end, current_period_end")
    .eq("status", "active")
    .eq("cancel_at_period_end", true)
    .not("current_period_end", "is", null);

  const nowMs = Date.now();
  for (const sub of cancelingSubs || []) {
    const endMs = new Date(String(sub.current_period_end)).getTime();
    if (!Number.isFinite(endMs) || endMs <= nowMs) continue;

    const daysRemaining = Math.ceil((endMs - nowMs) / (24 * 60 * 60 * 1000));
    if (daysRemaining === 7 || daysRemaining === 1) {
      const planSlug = normalizeOfficialPlanSlug(String(sub.plan)) || "pulse";
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", sub.organization_id)
        .maybeSingle();

      const periodDateKey = new Date(endMs).toISOString().slice(0, 10);
      const res = await enqueueBillingNotification(admin, {
        organizationId: String(sub.organization_id),
        eventType: "billing.subscription.expiring",
        idempotencyKeyPrefix: `expiry:${sub.id}:${periodDateKey}:${daysRemaining}d`,
        payload: {
          eventType: "billing.subscription.expiring",
          organizationName: String(org?.name || "Your Organization"),
          planName: OFFICIAL_PLANS[planSlug].name,
          periodEndDate: periodDateKey,
          daysRemaining,
        },
      });
      scheduledQueued += res.queuedIds.length;
    }
  }

  // 2. Check past_due final payment warnings (1 day before billing_recovery_deadline)
  const { data: pastDueSubs } = await admin
    .from("subscriptions")
    .select("id, organization_id, plan, status, billing_recovery_deadline, price_minor")
    .eq("status", "past_due")
    .not("billing_recovery_deadline", "is", null);

  for (const sub of pastDueSubs || []) {
    const deadlineMs = new Date(String(sub.billing_recovery_deadline)).getTime();
    if (!Number.isFinite(deadlineMs) || deadlineMs <= nowMs) continue;

    const daysLeft = Math.ceil((deadlineMs - nowMs) / (24 * 60 * 60 * 1000));
    if (daysLeft === 1) {
      const planSlug = normalizeOfficialPlanSlug(String(sub.plan)) || "pulse";
      const { data: org } = await admin
        .from("organizations")
        .select("name")
        .eq("id", sub.organization_id)
        .maybeSingle();

      const deadlineKey = new Date(deadlineMs).toISOString().slice(0, 10);
      const res = await enqueueBillingNotification(admin, {
        organizationId: String(sub.organization_id),
        eventType: "billing.payment.final_warning",
        idempotencyKeyPrefix: `final_warning:${sub.id}:${deadlineKey}`,
        payload: {
          eventType: "billing.payment.final_warning",
          organizationName: String(org?.name || "Your Organization"),
          planName: OFFICIAL_PLANS[planSlug].name,
          amountMinor: sub.price_minor ?? OFFICIAL_PLANS[planSlug].priceMinor,
          currency: "USD",
          recoveryDeadline: deadlineKey,
          daysRemaining: 1,
        },
      });
      scheduledQueued += res.queuedIds.length;
    }
  }

  // 3. Process pending and retry_scheduled outbox notifications
  const outboxSummary = await processNotificationOutboxBatch(admin, 25);

  return NextResponse.json({
    data: {
      scheduledRemindersQueued: scheduledQueued,
      outbox: outboxSummary,
    },
  });
}
