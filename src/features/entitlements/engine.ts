import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OFFICIAL_PLANS,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import type {
  EffectiveOrganizationEntitlements,
  OfficialPlanSlug,
  SubscriptionLifecycleStatus,
} from "@/types/billing";

export interface RawSubscriptionRow {
  id: string;
  organization_id: string;
  plan: string;
  status: string;
  billing_provider: string | null;
  dodo_subscription_id: string | null;
  dodo_product_id: string | null;
  price_minor: number | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  billing_recovery_deadline?: string | null;
  entitlement_overrides: Record<string, unknown> | null;
  updated_at?: string;
}

/**
 * Determines whether a subscription row is currently granting active entitlements.
 *
 * CRITICAL COMMERCIAL & SECURITY RULE:
 * - A paid subscription (`pulse`, `vector`, `quantum`) ONLY activates benefits
 *   after the payment and subscription state have been verified by the backend!
 * - `pending`, `payment_failed`, `incomplete`, `expired`, and `paused` NEVER
 *   grant paid plan benefits.
 * - `active`, `trialing`, `past_due` (within recovery grace period), or
 *   `cancellation_scheduled` / `canceled` (while `current_period_end > now`)
 *   grant the paid plan's entitlements.
 */
export function isSubscriptionGrantingEntitlements(
  sub: Pick<
    RawSubscriptionRow,
    "plan" | "status" | "current_period_end" | "billing_recovery_deadline"
  >,
  nowMs: number = Date.now(),
): boolean {
  const normalizedPlan = normalizeOfficialPlanSlug(sub.plan);
  if (!normalizedPlan) return false;

  const status = (sub.status || "").trim().toLowerCase();

  // Zero (free) plan is active when status is 'active' or 'free'
  if (normalizedPlan === "zero") {
    return status === "active" || status === "free";
  }

  // Paid plan states that NEVER grant paid benefits:
  if (
    status === "pending" ||
    status === "incomplete" ||
    status === "payment_failed" ||
    status === "expired" ||
    status === "paused"
  ) {
    return false;
  }

  if (
    status === "active" ||
    status === "trialing" ||
    status === "cancellation_scheduled"
  ) {
    if (sub.current_period_end) {
      const endMs = new Date(sub.current_period_end).getTime();
      if (Number.isFinite(endMs) && endMs <= nowMs) {
        return false;
      }
    }
    return true;
  }

  if (status === "past_due") {
    if (sub.billing_recovery_deadline) {
      const deadlineMs = new Date(sub.billing_recovery_deadline).getTime();
      if (Number.isFinite(deadlineMs) && deadlineMs <= nowMs) {
        return false;
      }
    }
    return true;
  }

  if (status === "canceled" || status === "cancelled") {
    if (!sub.current_period_end) return false;
    const endMs = new Date(sub.current_period_end).getTime();
    return Number.isFinite(endMs) && endMs > nowMs;
  }

  return false;
}

/**
 * Pure deterministic entitlement calculator for an organization.
 *
 * - Strictly excludes AI Credits (`aiCreditsIncluded: 0`).
 * - Falls back to Asiyst Zero (`zero`) if the organization has no verified
 *   paid subscription or if a checkout is still `pending`.
 * - Supports explicit administrative overrides stored in `entitlement_overrides`.
 */
export function computeEffectiveEntitlementsFromSubscription(
  organizationId: string,
  sub: RawSubscriptionRow | null,
  nowMs: number = Date.now(),
): EffectiveOrganizationEntitlements {
  const isGranting = sub ? isSubscriptionGrantingEntitlements(sub, nowMs) : false;
  const rawPlanSlug = sub ? normalizeOfficialPlanSlug(sub.plan) : "zero";

  // If subscription is pending payment or expired, fall back to 'zero' entitlements!
  const effectivePlanSlug: OfficialPlanSlug =
    isGranting && rawPlanSlug ? rawPlanSlug : "zero";

  const planDef = OFFICIAL_PLANS[effectivePlanSlug];
  const isPaidActive =
    isGranting &&
    (effectivePlanSlug === "pulse" ||
      effectivePlanSlug === "vector" ||
      effectivePlanSlug === "quantum");

  const rawStatus = (sub?.status || "free").toLowerCase();
  const lifecycleStatus: SubscriptionLifecycleStatus =
    sub && rawStatus === "active" && sub.cancel_at_period_end
      ? "cancellation_scheduled"
      : (rawStatus as SubscriptionLifecycleStatus) || "free";

  const overrides =
    isGranting &&
    sub?.entitlement_overrides &&
    typeof sub.entitlement_overrides === "object" &&
    !Array.isArray(sub.entitlement_overrides)
      ? sub.entitlement_overrides
      : {};

  const readNumberOverride = (key: string): number | null | undefined => {
    const val = overrides[key];
    if (val === "unlimited") return null;
    if (typeof val === "number" && Number.isSafeInteger(val) && val >= 0) {
      return val;
    }
    if (typeof val === "string" && /^[0-9]+$/.test(val)) {
      return parseInt(val, 10);
    }
    return undefined;
  };

  const readBoolOverride = (key: string, fallback: boolean): boolean => {
    if (typeof overrides[key] === "boolean") {
      return overrides[key] as boolean;
    }
    return fallback;
  };

  const defaultProjectsLimit =
    typeof planDef.limits.projects === "number" ? planDef.limits.projects : 1;
  const projectsLimit =
    readNumberOverride("projects.max_count") !== undefined
      ? readNumberOverride("projects.max_count")!
      : defaultProjectsLimit;

  const defaultSeatsLimit =
    typeof planDef.limits.organizationSeats === "number"
      ? planDef.limits.organizationSeats
      : 1;
  const seatsLimit =
    readNumberOverride("organization.max_members") !== undefined
      ? readNumberOverride("organization.max_members")!
      : defaultSeatsLimit;

  const defaultAssistantsLimit =
    typeof planDef.limits.assistants === "number" ? planDef.limits.assistants : 1;
  const assistantsLimit =
    readNumberOverride("assistants.max_count") !== undefined
      ? readNumberOverride("assistants.max_count")!
      : defaultAssistantsLimit;

  // Knowledge files: Zero = 0 custom file uploads (basic manual/sitemap context), Pulse = 5, Vector = 50, Quantum = unlimited (null)
  const defaultKnowledgeFilesLimit =
    planDef.limits.knowledgeFiles === "unlimited"
      ? null
      : planDef.limits.knowledgeFiles === "basic"
        ? 0
        : planDef.limits.knowledgeFiles;
  const knowledgeFilesLimit =
    readNumberOverride("knowledge.max_files") !== undefined
      ? readNumberOverride("knowledge.max_files")!
      : defaultKnowledgeFilesLimit;

  const isKnowledgeFilesUnlimited = knowledgeFilesLimit === null;

  const knowledgeEntriesLimit =
    readNumberOverride("knowledge.max_entries") !== undefined
      ? readNumberOverride("knowledge.max_entries")!
      : planDef.limits.knowledgeEntries;

  const knowledgeStorageLimit =
    readNumberOverride("knowledge.max_storage_bytes") !== undefined
      ? readNumberOverride("knowledge.max_storage_bytes")!
      : planDef.limits.knowledgeStorageBytes;

  const isPulseOrAbove =
    effectivePlanSlug === "pulse" ||
    effectivePlanSlug === "vector" ||
    effectivePlanSlug === "quantum";
  const isVectorOrAbove =
    effectivePlanSlug === "vector" || effectivePlanSlug === "quantum";
  const isQuantum = effectivePlanSlug === "quantum";

  return {
    organizationId,
    product: "asiyst-ai",
    plan: effectivePlanSlug,
    dbPlanKey: planDef.dbSlug,
    subscriptionId: sub?.id || null,
    status: lifecycleStatus,
    isPaidActive,
    isInGracePeriod: isGranting && rawStatus === "past_due",
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    currentPeriodStart: sub?.current_period_start || null,
    currentPeriodEnd: sub?.current_period_end || null,
    aiCreditsIncluded: 0, // Strictly 0 across all plans
    features: {
      projects: {
        enabled: true,
        limit: projectsLimit,
        unlimited: projectsLimit === null,
      },
      organization_seats: {
        enabled: true,
        limit: seatsLimit,
        unlimited: seatsLimit === null,
      },
      assistants: {
        enabled: true,
        limit: assistantsLimit,
        unlimited: assistantsLimit === null,
      },
      knowledge_files: {
        enabled: readBoolOverride(
          "knowledge.files_enabled",
          isPulseOrAbove || (knowledgeFilesLimit !== null && knowledgeFilesLimit > 0),
        ),
        limit: knowledgeFilesLimit,
        unlimited: isKnowledgeFilesUnlimited,
      },
      knowledge_entries: {
        enabled: true,
        limit: knowledgeEntriesLimit,
        unlimited: knowledgeEntriesLimit === null,
      },
      knowledge_storage_bytes: {
        enabled: true,
        limit: knowledgeStorageLimit,
        unlimited: knowledgeStorageLimit === null,
      },
      website_crawling: {
        enabled: true,
        tier: planDef.capabilityMatrix.websiteCrawling,
      },
      website_indexing: {
        enabled: true,
        tier: planDef.capabilityMatrix.websiteIndexing,
      },
      scheduled_crawling: {
        enabled: readBoolOverride(
          "website.scheduled_recrawling",
          planDef.capabilityMatrix.scheduledRecrawling,
        ),
      },
      index_monitoring: {
        enabled: readBoolOverride(
          "website.index_monitoring",
          planDef.capabilityMatrix.indexMonitoring,
        ),
      },
      custom_welcome: {
        enabled: true,
        tier: planDef.capabilityMatrix.customWelcome,
      },
      custom_appearance: {
        enabled: readBoolOverride("assistant.custom_appearance", isPulseOrAbove),
        tier: planDef.capabilityMatrix.customAppearance,
      },
      activity_logs: {
        enabled: readBoolOverride("monitoring.activity_logs", isPulseOrAbove),
        tier: planDef.capabilityMatrix.activityLogs,
      },
      basic_analytics: {
        enabled: true,
      },
      advanced_analytics: {
        enabled: readBoolOverride("analytics.advanced", isVectorOrAbove),
      },
      advanced_reporting: {
        enabled: readBoolOverride("analytics.advanced_reporting", isQuantum),
      },
      built_in_avatars: {
        enabled: true,
      },
      custom_avatar_upload: {
        enabled: readBoolOverride(
          "avatar.custom_upload",
          planDef.capabilityMatrix.customAvatarUpload,
        ),
      },
      advanced_avatar_capabilities: {
        enabled: readBoolOverride("avatar.advanced", isVectorOrAbove),
      },
      avatar_studio: {
        enabled: readBoolOverride(
          "avatar.studio",
          planDef.capabilityMatrix.avatarStudio,
        ),
      },
      advanced_animations: {
        enabled: readBoolOverride("avatar.advanced_animations", isVectorOrAbove),
      },
      team_collaboration: {
        enabled: readBoolOverride("collaboration.team", isVectorOrAbove),
      },
      multiple_integrations: {
        enabled: readBoolOverride("integrations.multiple", isVectorOrAbove),
      },
      audit_history: {
        enabled: readBoolOverride("admin.audit_history", isQuantum),
      },
      advanced_permissions: {
        enabled: readBoolOverride("admin.advanced_permissions", isQuantum),
      },
      organization_management: {
        enabled: readBoolOverride("admin.organization_management", isQuantum),
      },
      remove_asiyst_branding: {
        enabled: readBoolOverride(
          "branding.whitelabel",
          !planDef.capabilityMatrix.asiystBrandingVisible,
        ),
      },
      support_tier: {
        enabled: true,
        tier: planDef.capabilityMatrix.support,
      },
    },
  };
}

/**
 * Selects the authoritative subscription for an organization from a list of rows.
 * Prioritizes verified active paid subscriptions over free rows or pending checkouts.
 */
export function selectAuthoritativeSubscription(
  rows: RawSubscriptionRow[],
  nowMs: number = Date.now(),
): RawSubscriptionRow | null {
  if (!rows || rows.length === 0) return null;

  // 1. Active / granting paid subscription
  const activePaid = rows.find((r) => {
    const slug = normalizeOfficialPlanSlug(r.plan);
    return slug && slug !== "zero" && isSubscriptionGrantingEntitlements(r, nowMs);
  });
  if (activePaid) return activePaid;

  // 2. Active free (Zero) subscription
  const activeZero = rows.find((r) => {
    const slug = normalizeOfficialPlanSlug(r.plan);
    return slug === "zero" && isSubscriptionGrantingEntitlements(r, nowMs);
  });
  if (activeZero) return activeZero;

  // 3. Most recently updated row (e.g. pending or expired) for status visibility
  return rows[0];
}

/**
 * Fetches the authoritative organization subscription and computes effective entitlements.
 */
export async function getOrganizationEffectiveEntitlements(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{
  entitlements: EffectiveOrganizationEntitlements;
  rawSubscription: RawSubscriptionRow | null;
}> {
  const { data, error } = await admin
    .from("subscriptions")
    .select(
      "id, organization_id, plan, status, billing_provider, dodo_subscription_id, dodo_product_id, price_minor, current_period_start, current_period_end, cancel_at_period_end, billing_recovery_deadline, entitlement_overrides, updated_at",
    )
    .eq("organization_id", organizationId)
    .order("updated_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load organization subscriptions: ${error.message}`);
  }

  const rows = (data || []) as RawSubscriptionRow[];
  const chosen = selectAuthoritativeSubscription(rows);
  const entitlements = computeEffectiveEntitlementsFromSubscription(
    organizationId,
    chosen,
  );

  return {
    entitlements,
    rawSubscription: chosen,
  };
}

export interface EntitlementCheckRequest {
  featureKey: keyof EffectiveOrganizationEntitlements["features"];
  requestedAmount?: number;
  currentUsage?: number;
}

export interface EntitlementCheckResponse {
  allowed: boolean;
  plan: OfficialPlanSlug;
  isPaidActive: boolean;
  featureKey: string;
  enabled: boolean;
  limit: number | null;
  unlimited: boolean;
  currentUsage: number;
  requestedAmount: number;
  reason?: string;
}

/**
 * Evaluates a specific feature or numeric quota against effective entitlements.
 */
export function evaluateEntitlementCheck(
  entitlements: EffectiveOrganizationEntitlements,
  check: EntitlementCheckRequest,
): EntitlementCheckResponse {
  const entry = entitlements.features[check.featureKey] as {
    enabled: boolean;
    limit?: number | null;
    unlimited?: boolean;
  };

  const requestedAmount = check.requestedAmount ?? 1;
  const currentUsage = check.currentUsage ?? 0;

  if (!entry || !entry.enabled) {
    return {
      allowed: false,
      plan: entitlements.plan,
      isPaidActive: entitlements.isPaidActive,
      featureKey: check.featureKey,
      enabled: false,
      limit: entry?.limit ?? 0,
      unlimited: false,
      currentUsage,
      requestedAmount,
      reason: `Feature '${check.featureKey}' is not enabled on the ${OFFICIAL_PLANS[entitlements.plan].name} plan.`,
    };
  }

  const isUnlimited = entry.unlimited === true || entry.limit === null || entry.limit === undefined;
  if (!isUnlimited && typeof entry.limit === "number") {
    if (currentUsage + requestedAmount > entry.limit) {
      return {
        allowed: false,
        plan: entitlements.plan,
        isPaidActive: entitlements.isPaidActive,
        featureKey: check.featureKey,
        enabled: true,
        limit: entry.limit,
        unlimited: false,
        currentUsage,
        requestedAmount,
        reason: `Quota limit reached for '${check.featureKey}' (${currentUsage}/${entry.limit}) on ${OFFICIAL_PLANS[entitlements.plan].name}.`,
      };
    }
  }

  return {
    allowed: true,
    plan: entitlements.plan,
    isPaidActive: entitlements.isPaidActive,
    featureKey: check.featureKey,
    enabled: true,
    limit: entry.limit ?? null,
    unlimited: isUnlimited,
    currentUsage,
    requestedAmount,
  };
}
