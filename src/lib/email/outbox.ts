import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_EMAIL_FROM,
  DEFAULT_EMAIL_REPLY_TO,
  isEssentialBillingEmail,
  renderBillingEmailTemplate,
  type EmailTemplatePayload,
} from "@/features/email-templates/templates";
import type { BillingEmailEventType } from "@/types/billing";

export const MAX_OUTBOX_ATTEMPTS = 5;
export const STALE_CLAIM_MS = 15 * 60 * 1000;

export interface BillingRecipient {
  userId: string | null;
  email: string;
  role: "owner" | "billing_admin" | "verified_contact";
}

/**
 * Calculates bounded exponential backoff with deterministic/random jitter.
 */
export function computeRetryBackoffMs(attemptCount: number): number {
  const exp = Math.min(Math.max(attemptCount, 1), 8);
  const baseMs = Math.min(Math.pow(2, exp) * 2000, 3600_000);
  const jitterMs = Math.floor(Math.random() * 1000);
  return baseMs + jitterMs;
}

/**
 * Resolves and deduplicates all authorized billing recipients for an organization:
 * 1. Organization owner (verified email)
 * 2. Authorized billing administrators (`can_manage_billing = true`, verified email)
 * 3. Verified organization billing contact (`organization_billing_contacts.email_verified = true`)
 *
 * Strictly excludes ordinary members and unverified billing contacts.
 */
export async function resolveOrganizationBillingRecipients(
  admin: SupabaseClient,
  organizationId: string,
  eventType: BillingEmailEventType,
): Promise<BillingRecipient[]> {
  const deduplicated = new Map<string, BillingRecipient>();

  // 1. Query organization members with owner or can_manage_billing
  const { data: members } = await admin
    .from("organization_members")
    .select("user_id, role, can_manage_billing")
    .eq("organization_id", organizationId);

  const eligibleMembers = (members || []).filter(
    (m) => m.role === "owner" || m.can_manage_billing === true,
  );

  for (const member of eligibleMembers) {
    const userId = String(member.user_id);

    // Check optional notification preference if non-essential
    if (!isEssentialBillingEmail(eventType)) {
      const { data: pref } = await admin
        .from("notification_preferences")
        .select("enabled")
        .eq("organization_id", organizationId)
        .eq("user_id", userId)
        .eq("notification_category", "usage_alerts")
        .maybeSingle();

      if (pref && pref.enabled === false) {
        continue;
      }
    }

    // Verify user email via auth.admin or profiles
    let verifiedEmail: string | null = null;
    try {
      const { data: authData } = await admin.auth.admin.getUserById(userId);
      if (
        authData?.user?.email &&
        authData.user.email_confirmed_at &&
        authData.user.email.includes("@")
      ) {
        verifiedEmail = authData.user.email.trim().toLowerCase();
      }
    } catch {
      const { data: profile } = await admin
        .from("profiles")
        .select("email")
        .eq("id", userId)
        .maybeSingle();
      if (profile?.email && String(profile.email).includes("@")) {
        verifiedEmail = String(profile.email).trim().toLowerCase();
      }
    }

    if (verifiedEmail && !deduplicated.has(verifiedEmail)) {
      deduplicated.set(verifiedEmail, {
        userId,
        email: verifiedEmail,
        role: member.role === "owner" ? "owner" : "billing_admin",
      });
    }
  }

  // 2. Check verified organization billing contact
  const { data: contact } = await admin
    .from("organization_billing_contacts")
    .select("billing_email, email_verified")
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (
    contact?.email_verified === true &&
    typeof contact.billing_email === "string" &&
    contact.billing_email.includes("@")
  ) {
    const contactEmail = contact.billing_email.trim().toLowerCase();
    if (!deduplicated.has(contactEmail)) {
      deduplicated.set(contactEmail, {
        userId: null,
        email: contactEmail,
        role: "verified_contact",
      });
    }
  }

  return Array.from(deduplicated.values());
}

export interface EnqueueBillingNotificationInput {
  organizationId: string;
  eventType: BillingEmailEventType;
  idempotencyKeyPrefix: string;
  payload: EmailTemplatePayload;
  explicitRecipients?: Array<{ email: string; userId?: string | null }>;
}

/**
 * Enqueues durable notification records into `notification_outbox` (and mirrors into
 * `notification_events` / `email_deliveries` when applicable for backward compatibility).
 * Deduplicates via unique `idempotency_key`.
 */
export async function enqueueBillingNotification(
  admin: SupabaseClient,
  input: EnqueueBillingNotificationInput,
): Promise<{ queuedIds: string[]; duplicateCount: number }> {
  const recipients: BillingRecipient[] = input.explicitRecipients
    ? Array.from(
        new Map(
          input.explicitRecipients
            .filter((r) => r.email && r.email.includes("@"))
            .map((r) => [
              r.email.trim().toLowerCase(),
              {
                userId: r.userId || null,
                email: r.email.trim().toLowerCase(),
                role: "billing_admin" as const,
              },
            ]),
        ).values(),
      )
    : await resolveOrganizationBillingRecipients(
        admin,
        input.organizationId,
        input.eventType,
      );

  const rendered = renderBillingEmailTemplate(input.payload);
  const queuedIds: string[] = [];
  let duplicateCount = 0;

  for (const recipient of recipients) {
    const idempotencyKey = `${input.idempotencyKeyPrefix}:${recipient.email}`;

    const { data: existing } = await admin
      .from("notification_outbox")
      .select("id")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (existing?.id) {
      duplicateCount += 1;
      continue;
    }

    const { data: inserted, error } = await admin
      .from("notification_outbox")
      .insert({
        organization_id: input.organizationId,
        user_id: recipient.userId,
        recipient_email: recipient.email,
        event_type: input.eventType,
        idempotency_key: idempotencyKey,
        template_key: input.eventType,
        subject: rendered.subject,
        payload: input.payload as unknown as Record<string, unknown>,
        status: "pending",
        attempt_count: 0,
        next_attempt_at: new Date().toISOString(),
        provider: "resend",
      })
      .select("id")
      .maybeSingle();

    if (error) {
      if (error.code === "23505") {
        duplicateCount += 1;
        continue;
      }
      throw new Error(`Unable to enqueue notification outbox record: ${error.message}`);
    }

    if (inserted?.id) {
      queuedIds.push(String(inserted.id));
    }
  }

  return { queuedIds, duplicateCount };
}

/**
 * Claims and dispatches a single `notification_outbox` record via Resend.
 * Re-verifies current database state immediately before sending scheduled reminders!
 */
export async function processSingleOutboxNotification(
  admin: SupabaseClient,
  outboxId: string,
): Promise<{
  id: string;
  status: "sent" | "retry_scheduled" | "failed" | "dead_letter" | "skipped";
  providerMessageId?: string | null;
  error?: string;
}> {
  const { data: record, error: loadError } = await admin
    .from("notification_outbox")
    .select("*")
    .eq("id", outboxId)
    .maybeSingle();

  if (loadError || !record) {
    return { id: outboxId, status: "failed", error: "Outbox record not found." };
  }

  if (record.status === "sent") {
    return {
      id: outboxId,
      status: "sent",
      providerMessageId: record.provider_message_id,
    };
  }

  // Atomic job claim
  const nextAttempt = (Number(record.attempt_count) || 0) + 1;
  const { data: claimed } = await admin
    .from("notification_outbox")
    .update({
      status: "processing",
      attempt_count: nextAttempt,
      claimed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", outboxId)
    .in("status", ["pending", "retry_scheduled", "failed"])
    .select("*")
    .maybeSingle();

  if (!claimed) {
    return { id: outboxId, status: "skipped", error: "Already claimed by another worker." };
  }

  const payload = (record.payload || {}) as EmailTemplatePayload;

  // State re-verification for scheduled expiration & payment recovery reminders
  if (
    record.event_type === "billing.subscription.expiring" ||
    record.event_type === "billing.payment.final_warning"
  ) {
    const { data: activeSub } = await admin
      .from("subscriptions")
      .select("status, cancel_at_period_end, billing_recovery_deadline")
      .eq("organization_id", record.organization_id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const shouldSuppress =
      record.event_type === "billing.subscription.expiring"
        ? !activeSub ||
          activeSub.status !== "active" ||
          activeSub.cancel_at_period_end !== true
        : !activeSub || activeSub.status !== "past_due";

    if (shouldSuppress) {
      await admin
        .from("notification_outbox")
        .update({
          status: "skipped",
          last_error_code: "SUPPRESSED_STALE_STATE",
          last_error_message:
            "Subscription renewed, reactivated, or recovered before reminder dispatch.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", outboxId);

      return { id: outboxId, status: "skipped" };
    }
  }

  const resendApiKey = process.env.RESEND_API_KEY?.trim() || "";
  const fromEmail =
    process.env.RESEND_FROM_EMAIL?.trim() ||
    process.env.EMAIL_FROM?.trim() ||
    DEFAULT_EMAIL_FROM;
  const replyTo =
    process.env.RESEND_REPLY_TO?.trim() ||
    process.env.EMAIL_REPLY_TO?.trim() ||
    DEFAULT_EMAIL_REPLY_TO;

  if (!resendApiKey) {
    await admin
      .from("notification_outbox")
      .update({
        status: "retry_scheduled",
        next_attempt_at: new Date(
          Date.now() + computeRetryBackoffMs(nextAttempt),
        ).toISOString(),
        last_error_code: "PROVIDER_NOT_CONFIGURED",
        last_error_message: "RESEND_API_KEY is not configured in server environment.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);

    return {
      id: outboxId,
      status: "retry_scheduled",
      error: "RESEND_API_KEY is not configured.",
    };
  }

  const rendered = renderBillingEmailTemplate({
    ...payload,
    eventType: record.event_type as BillingEmailEventType,
  });

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": String(record.idempotency_key),
      },
      body: JSON.stringify({
        from: fromEmail,
        to: [record.recipient_email],
        reply_to: replyTo,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });

    const data = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;

    if (!response.ok) {
      const httpStatus = response.status;
      const isTransient = httpStatus === 429 || httpStatus >= 500;
      const errorMsg =
        typeof data.message === "string"
          ? data.message
          : `Resend HTTP ${httpStatus}`;

      const finalStatus =
        isTransient && nextAttempt < MAX_OUTBOX_ATTEMPTS
          ? "retry_scheduled"
          : nextAttempt >= MAX_OUTBOX_ATTEMPTS
            ? "dead_letter"
            : "failed";

      await admin
        .from("notification_outbox")
        .update({
          status: finalStatus,
          next_attempt_at: new Date(
            Date.now() + computeRetryBackoffMs(nextAttempt),
          ).toISOString(),
          last_error_code: `HTTP_${httpStatus}`,
          last_error_message: errorMsg,
          updated_at: new Date().toISOString(),
        })
        .eq("id", outboxId);

      return { id: outboxId, status: finalStatus, error: errorMsg };
    }

    const providerMessageId = typeof data.id === "string" ? data.id : null;
    await admin
      .from("notification_outbox")
      .update({
        status: "sent",
        provider_message_id: providerMessageId,
        delivery_status: "accepted",
        sent_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);

    return { id: outboxId, status: "sent", providerMessageId };
  } catch (err) {
    const errorMsg =
      err instanceof Error ? err.message : "Network timeout contacting Resend";
    const finalStatus =
      nextAttempt < MAX_OUTBOX_ATTEMPTS ? "retry_scheduled" : "dead_letter";

    await admin
      .from("notification_outbox")
      .update({
        status: finalStatus,
        next_attempt_at: new Date(
          Date.now() + computeRetryBackoffMs(nextAttempt),
        ).toISOString(),
        last_error_code: "NETWORK_ERROR",
        last_error_message: errorMsg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", outboxId);

    return { id: outboxId, status: finalStatus, error: errorMsg };
  }
}

/**
 * Worker batch processor: recovers stale claims and processes due outbox notifications.
 */
export async function processNotificationOutboxBatch(
  admin: SupabaseClient,
  limit: number = 25,
): Promise<{
  processed: number;
  sent: number;
  retried: number;
  failed: number;
  skipped: number;
}> {
  const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  await admin
    .from("notification_outbox")
    .update({
      status: "retry_scheduled",
      last_error_code: "STALE_WORKER_RECOVERY",
      last_error_message: "Recovered stale processing lock",
      updated_at: new Date().toISOString(),
    })
    .eq("status", "processing")
    .lt("claimed_at", staleCutoff);

  const nowIso = new Date().toISOString();
  const { data: jobs } = await admin
    .from("notification_outbox")
    .select("id")
    .in("status", ["pending", "retry_scheduled"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(limit);

  const summary = { processed: 0, sent: 0, retried: 0, failed: 0, skipped: 0 };
  if (!jobs || jobs.length === 0) return summary;

  for (const job of jobs) {
    summary.processed += 1;
    const res = await processSingleOutboxNotification(admin, String(job.id));
    if (res.status === "sent") summary.sent += 1;
    else if (res.status === "retry_scheduled") summary.retried += 1;
    else if (res.status === "skipped") summary.skipped += 1;
    else summary.failed += 1;
  }

  return summary;
}
