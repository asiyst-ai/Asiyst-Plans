import type { SupabaseClient } from "@supabase/supabase-js";
import {
  OFFICIAL_PLANS,
  getMinimumPlanForCapability,
  normalizeOfficialPlanSlug,
} from "@/features/catalog/plans";
import type {
  CanonicalFeatureKey,
  CanonicalQuotaKey,
  EffectiveOrganizationEntitlements,
  EntitlementAccessError,
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
  scheduled_plan?: string | null;
  scheduled_change_effective_at?: string | null;
  billing_recovery_deadline?: string | null;
  entitlement_overrides: Record<string, unknown> | null;
  updated_at?: string;
}

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

  if (normalizedPlan === "zero") {
    return status === "active" || status === "free";
  }

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

export function computeEffectiveEntitlementsFromSubscription(
  organizationId: string,
  sub: RawSubscriptionRow | null,
  nowMs: number = Date.now(),
): EffectiveOrganizationEntitlements {
  const isGranting = sub ? isSubscriptionGrantingEntitlements(sub, nowMs) : false;
  const rawPlanSlug = sub ? normalizeOfficialPlanSlug(sub.plan) : "zero";
  const rawStatus = (sub?.status || "free").trim().toLowerCase();

  const scheduledPlanSlug = sub?.scheduled_plan
    ? normalizeOfficialPlanSlug(sub.scheduled_plan)
    : null;
  const scheduledEffectiveMs = sub?.scheduled_change_effective_at
    ? new Date(sub.scheduled_change_effective_at).getTime()
    : NaN;
  const isScheduledPlanNowEffective =
    Boolean(scheduledPlanSlug) &&
    Number.isFinite(scheduledEffectiveMs) &&
    scheduledEffectiveMs <= nowMs;

  const effectivePlanSlug: OfficialPlanSlug = isGranting
    ? isScheduledPlanNowEffective && scheduledPlanSlug
      ? scheduledPlanSlug
      : rawPlanSlug || "zero"
    : "zero";

  const planDef = OFFICIAL_PLANS[effectivePlanSlug];
  const isPaidActive =
    isGranting &&
    (effectivePlanSlug === "pulse" ||
      effectivePlanSlug === "vector" ||
      effectivePlanSlug === "quantum");

  const isExpired =
    Boolean(sub) &&
    rawPlanSlug !== "zero" &&
    (rawStatus === "expired" ||
      ((rawStatus === "canceled" ||
        rawStatus === "cancelled" ||
        rawStatus === "active" ||
        rawStatus === "cancellation_scheduled") &&
        Boolean(sub?.current_period_end) &&
        new Date(sub!.current_period_end!).getTime() <= nowMs));

  const hasBillingFailure =
    Boolean(sub) &&
    rawPlanSlug !== "zero" &&
    (rawStatus === "payment_failed" ||
      (rawStatus === "past_due" &&
        Boolean(sub?.billing_recovery_deadline) &&
        new Date(sub!.billing_recovery_deadline!).getTime() <= nowMs));

  const lifecycleStatus: SubscriptionLifecycleStatus =
    sub && rawStatus === "active" && sub.cancel_at_period_end
      ? "cancellation_scheduled"
      : isExpired && rawStatus === "active"
        ? "expired"
        : (rawStatus as SubscriptionLifecycleStatus) || "free";

  const overrides =
    isGranting &&
    sub?.entitlement_overrides &&
    typeof sub.entitlement_overrides === "object" &&
    !Array.isArray(sub.entitlement_overrides)
      ? sub.entitlement_overrides
      : {};

  const resolveQuota = (
    overrideKey: string,
    defaultLimit: number | null,
  ): { limit: number | null; unlimited: boolean } => {
    const val = overrides[overrideKey];
    if (val === "unlimited") return { limit: null, unlimited: true };
    if (typeof val === "number" && Number.isSafeInteger(val) && val >= 0) {
      return { limit: val, unlimited: false };
    }
    if (typeof val === "string" && /^[0-9]+$/.test(val)) {
      return { limit: parseInt(val, 10), unlimited: false };
    }
    return { limit: defaultLimit, unlimited: defaultLimit === null };
  };

  const readBoolOverride = (key: string, fallback: boolean): boolean => {
    if (typeof overrides[key] === "boolean") {
      return overrides[key] as boolean;
    }
    return fallback;
  };

  const workspacesQ = resolveQuota("workspaces.max_count", planDef.limits.workspaces);
  const projectsQ = resolveQuota("projects.max_count", planDef.limits.projects);
  const seatsQ = resolveQuota("organization.max_members", planDef.limits.organizationSeats);
  const assistantsQ = resolveQuota("assistants.max_count", planDef.limits.assistants);
  const knowledgeFilesQ = resolveQuota("knowledge.max_files", planDef.limits.knowledgeFiles);
  const knowledgeEntriesQ = resolveQuota("knowledge.max_entries", planDef.limits.knowledgeEntries);
  const knowledgeUnitsQ = resolveQuota("knowledge.max_units", planDef.limits.knowledgeUnits);
  const knowledgeStorageQ = resolveQuota(
    "knowledge.max_storage_bytes",
    planDef.limits.knowledgeStorageBytes,
  );
  const crawlPagesQ = resolveQuota("crawl.max_pages", planDef.limits.crawlPages);
  const scheduledJobsQ = resolveQuota(
    "knowledge.max_scheduled_jobs",
    planDef.limits.scheduledSyncJobs,
  );

  const capabilities = {} as Record<CanonicalFeatureKey, boolean>;
  for (const [k, v] of Object.entries(planDef.capabilities)) {
    capabilities[k as CanonicalFeatureKey] = readBoolOverride(k, v);
  }

  const resetPeriod: "monthly" | "billing_period" = isPaidActive
    ? "billing_period"
    : "monthly";

  return {
    organizationId,
    product: "asiyst-ai",
    plan: effectivePlanSlug,
    dbPlanKey: planDef.dbSlug,
    subscriptionId: sub?.id || null,
    status: lifecycleStatus,
    isPaidActive,
    isInGracePeriod: isGranting && rawStatus === "past_due",
    isExpired,
    hasBillingFailure,
    cancelAtPeriodEnd: Boolean(sub?.cancel_at_period_end),
    scheduledPlan: !isScheduledPlanNowEffective ? scheduledPlanSlug : null,
    scheduledChangeEffectiveAt: !isScheduledPlanNowEffective
      ? sub?.scheduled_change_effective_at || null
      : null,
    currentPeriodStart: sub?.current_period_start || null,
    currentPeriodEnd: sub?.current_period_end || null,
    resetPeriod,
    aiCreditsIncluded: 0,
    capabilities,
    quotas: {
      projects: { ...projectsQ, resetPeriod: "none" },
      workspaces: { ...workspacesQ, resetPeriod: "none" },
      organization_seats: { ...seatsQ, resetPeriod: "none" },
      assistants: { ...assistantsQ, resetPeriod: "none" },
      knowledge_files: { ...knowledgeFilesQ, resetPeriod: "none" },
      knowledge_entries: { ...knowledgeEntriesQ, resetPeriod: "none" },
      knowledge_units: { ...knowledgeUnitsQ, resetPeriod: "none" },
      knowledge_storage_bytes: { ...knowledgeStorageQ, resetPeriod: "none" },
      crawl_pages: {
        ...crawlPagesQ,
        fairUseCap: planDef.limits.crawlFairUseCap,
        resetPeriod,
      },
      scheduled_sync_jobs: { ...scheduledJobsQ, resetPeriod: "none" },
      analytics_history_days: {
        limit: planDef.limits.analyticsHistoryDays ?? 7,
        unlimited: false,
        resetPeriod: "none",
      },
    },
    features: {
      workspaces: { enabled: true, ...workspacesQ },
      projects: { enabled: true, ...projectsQ },
      organization_seats: { enabled: true, ...seatsQ },
      assistants: { enabled: true, ...assistantsQ },
      knowledge_files: {
        enabled: knowledgeFilesQ.unlimited || (knowledgeFilesQ.limit ?? 0) > 0,
        ...knowledgeFilesQ,
      },
      knowledge_entries: { enabled: true, ...knowledgeEntriesQ },
      knowledge_units: { enabled: true, ...knowledgeUnitsQ },
      knowledge_storage_bytes: { enabled: true, ...knowledgeStorageQ },
      crawl_pages: {
        enabled: crawlPagesQ.unlimited || (crawlPagesQ.limit ?? 0) > 0,
        ...crawlPagesQ,
        fairUseCap: planDef.limits.crawlFairUseCap,
        resetPeriod,
      },
      scheduled_sync_jobs: {
        enabled: capabilities["knowledge.scheduled_sync"],
        ...scheduledJobsQ,
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
        enabled: capabilities["knowledge.scheduled_sync"],
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
        enabled: capabilities["avatar.customization"],
        tier: planDef.capabilityMatrix.customAppearance,
      },
      activity_logs: {
        enabled: readBoolOverride(
          "monitoring.activity_logs",
          effectivePlanSlug !== "zero",
        ),
        tier: planDef.capabilityMatrix.activityLogs,
      },
      basic_analytics: {
        enabled: capabilities["analytics.basic"],
      },
      advanced_analytics: {
        enabled: capabilities["analytics.advanced"],
      },
      conversion_analytics: {
        enabled: capabilities["analytics.conversion"],
      },
      analytics_export: {
        enabled: capabilities["analytics.export"],
      },
      multi_project_analytics: {
        enabled: capabilities["analytics.multi_project"],
      },
      cohort_analytics: {
        enabled: capabilities["analytics.cohort"],
      },
      ai_analytics_summary: {
        enabled: capabilities["analytics.ai_summary"],
      },
      anomaly_detection: {
        enabled: capabilities["analytics.anomaly_detection"],
      },
      advanced_reporting: {
        enabled: readBoolOverride(
          "analytics.advanced_reporting",
          planDef.capabilityMatrix.advancedReporting,
        ),
      },
      built_in_avatars: {
        enabled: true,
      },
      avatar_chat: {
        enabled: capabilities["avatar.chat"],
      },
      custom_avatar_upload: {
        enabled: capabilities["avatar.custom_upload"],
      },
      advanced_avatar_capabilities: {
        enabled: capabilities["avatar.advanced"],
      },
      avatar_studio: {
        enabled: capabilities["avatar.studio"],
      },
      advanced_animations: {
        enabled: capabilities["avatar.advanced"],
      },
      enhanced_visitor_interactions: {
        enabled: capabilities["visitor.enhanced_interactions"],
      },
      team_collaboration: {
        enabled: readBoolOverride(
          "collaboration.team",
          effectivePlanSlug === "vector" || effectivePlanSlug === "quantum",
        ),
      },
      multiple_integrations: {
        enabled: readBoolOverride(
          "integrations.multiple",
          effectivePlanSlug === "vector" || effectivePlanSlug === "quantum",
        ),
      },
      audit_history: {
        enabled: readBoolOverride("admin.audit_history", effectivePlanSlug === "quantum"),
      },
      knowledge_versioning: {
        enabled: capabilities["knowledge.versioning"],
      },
      advanced_permissions: {
        enabled: capabilities["advanced_permissions"],
      },
      organization_management: {
        enabled: readBoolOverride(
          "admin.organization_management",
          effectivePlanSlug === "vector" || effectivePlanSlug === "quantum",
        ),
      },
      advanced_project_management: {
        enabled: capabilities["projects.advanced_management"],
      },
      remove_asiyst_branding: {
        enabled: capabilities["branding.whitelabel"],
      },
      full_whitelabel: {
        enabled: capabilities["branding.full_whitelabel"],
      },
      support_tier: {
        enabled: true,
        tier: planDef.capabilityMatrix.support,
      },
    },
  };
}

export function selectAuthoritativeSubscription(
  rows: RawSubscriptionRow[],
  nowMs: number = Date.now(),
): RawSubscriptionRow | null {
  if (!rows || rows.length === 0) return null;

  const activePaid = rows.find((r) => {
    const slug = normalizeOfficialPlanSlug(r.plan);
    return slug && slug !== "zero" && isSubscriptionGrantingEntitlements(r, nowMs);
  });
  if (activePaid) return activePaid;

  // Prefer recent expired/failed paid row over silent free row so expired/billing-failure reason is preserved
  const nonZeroProblem = rows.find((r) => {
    const slug = normalizeOfficialPlanSlug(r.plan);
    const status = (r.status || "").toLowerCase();
    return (
      slug &&
      slug !== "zero" &&
      ["expired", "payment_failed", "past_due", "canceled", "cancelled"].includes(status)
    );
  });
  if (nonZeroProblem) return nonZeroProblem;

  const activeZero = rows.find((r) => {
    const slug = normalizeOfficialPlanSlug(r.plan);
    return slug === "zero" && isSubscriptionGrantingEntitlements(r, nowMs);
  });
  if (activeZero) return activeZero;

  return rows[0];
}

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
      "id, organization_id, plan, status, billing_provider, dodo_subscription_id, dodo_product_id, price_minor, current_period_start, current_period_end, cancel_at_period_end, scheduled_plan, scheduled_change_effective_at, billing_recovery_deadline, entitlement_overrides, updated_at",
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

export const getEffectiveEntitlements = getOrganizationEffectiveEntitlements;

export function checkFeatureAccess(
  entitlements: EffectiveOrganizationEntitlements,
  feature: CanonicalFeatureKey,
): { allowed: true } | { allowed: false; decision: EntitlementAccessError } {
  if (entitlements.capabilities[feature]) {
    return { allowed: true };
  }

  const requiredPlan = getMinimumPlanForCapability(feature);
  const planAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plan.asiyst.com";

  if (entitlements.hasBillingFailure) {
    return {
      allowed: false,
      decision: {
        code: "BILLING_FAILURE",
        httpStatus: 402,
        feature,
        currentPlan: entitlements.plan,
        requiredPlan,
        subscriptionStatus: entitlements.status,
        limit: null,
        currentUsage: 0,
        upgradeUrl: `${planAppUrl}/account/billing`,
        message: `Payment failed for your subscription. Update your payment method to restore '${feature}'.`,
      },
    };
  }

  if (entitlements.isExpired) {
    return {
      allowed: false,
      decision: {
        code: "SUBSCRIPTION_EXPIRED",
        httpStatus: 403,
        feature,
        currentPlan: entitlements.plan,
        requiredPlan,
        subscriptionStatus: entitlements.status,
        limit: null,
        currentUsage: 0,
        upgradeUrl: `${planAppUrl}/checkout?plan=${requiredPlan}`,
        message: `Your paid subscription has expired. Renew or upgrade to ${OFFICIAL_PLANS[requiredPlan].name} to access '${feature}'.`,
      },
    };
  }

  return {
    allowed: false,
    decision: {
      code: "FEATURE_NOT_AVAILABLE",
      httpStatus: 403,
      feature,
      currentPlan: entitlements.plan,
      requiredPlan,
      subscriptionStatus: entitlements.status,
      limit: null,
      currentUsage: 0,
      upgradeUrl: `${planAppUrl}/checkout?plan=${requiredPlan}`,
      message: `Feature '${feature}' requires ${OFFICIAL_PLANS[requiredPlan].name} or higher (current plan: ${OFFICIAL_PLANS[entitlements.plan].name}).`,
    },
  };
}

export function checkQuotaAccess(
  entitlements: EffectiveOrganizationEntitlements,
  quotaKey: CanonicalQuotaKey,
  currentUsage: number,
  requestedAmount: number = 1,
):
  | { allowed: true; limit: number | null; unlimited: boolean; remaining: number | null }
  | { allowed: false; decision: EntitlementAccessError } {
  const quota = entitlements.quotas[quotaKey];
  const planAppUrl = process.env.NEXT_PUBLIC_APP_URL || "https://plan.asiyst.com";

  const nextPlanMap: Record<OfficialPlanSlug, OfficialPlanSlug> = {
    zero: "pulse",
    pulse: "vector",
    vector: "quantum",
    quantum: "quantum",
  };
  const requiredPlan = nextPlanMap[entitlements.plan];

  if (!quota.unlimited && quota.limit === 0) {
    return {
      allowed: false,
      decision: {
        code: "ZERO_QUOTA",
        httpStatus: 403,
        feature: quotaKey,
        currentPlan: entitlements.plan,
        requiredPlan,
        subscriptionStatus: entitlements.status,
        limit: 0,
        currentUsage,
        upgradeUrl: `${planAppUrl}/checkout?plan=${requiredPlan}`,
        message: `Your ${OFFICIAL_PLANS[entitlements.plan].name} plan has a 0 allowance for '${quotaKey}'. Upgrade to ${OFFICIAL_PLANS[requiredPlan].name}.`,
      },
    };
  }

  if (!quota.unlimited && typeof quota.limit === "number") {
    if (currentUsage + requestedAmount > quota.limit) {
      const code = entitlements.hasBillingFailure
        ? "BILLING_FAILURE"
        : entitlements.isExpired
          ? "SUBSCRIPTION_EXPIRED"
          : "QUOTA_EXHAUSTED";
      return {
        allowed: false,
        decision: {
          code,
          httpStatus: code === "BILLING_FAILURE" ? 402 : 429,
          feature: quotaKey,
          currentPlan: entitlements.plan,
          requiredPlan,
          subscriptionStatus: entitlements.status,
          limit: quota.limit,
          currentUsage,
          upgradeUrl: `${planAppUrl}/checkout?plan=${requiredPlan}`,
          message: `Quota exhausted for '${quotaKey}' (${currentUsage}/${quota.limit}) on ${OFFICIAL_PLANS[entitlements.plan].name}. Upgrade to ${OFFICIAL_PLANS[requiredPlan].name} for higher capacity.`,
        },
      };
    }
    return {
      allowed: true,
      limit: quota.limit,
      unlimited: false,
      remaining: Math.max(0, quota.limit - (currentUsage + requestedAmount)),
    };
  }

  return {
    allowed: true,
    limit: null,
    unlimited: true,
    remaining: null,
  };
}

export interface EntitlementCheckRequest {
  featureKey: string;
  requestedAmount?: number;
  currentUsage?: number;
}

export interface EntitlementCheckResponse {
  allowed: boolean;
  code?: EntitlementAccessError["code"];
  plan: OfficialPlanSlug;
  requiredPlan?: OfficialPlanSlug;
  isPaidActive: boolean;
  featureKey: string;
  enabled: boolean;
  limit: number | null;
  unlimited: boolean;
  currentUsage: number;
  requestedAmount: number;
  upgradeUrl?: string;
  reason?: string;
}

export function evaluateEntitlementCheck(
  entitlements: EffectiveOrganizationEntitlements,
  check: EntitlementCheckRequest,
): EntitlementCheckResponse {
  const requestedAmount = check.requestedAmount ?? 1;
  const currentUsage = check.currentUsage ?? 0;

  if (check.featureKey in entitlements.capabilities) {
    const res = checkFeatureAccess(
      entitlements,
      check.featureKey as CanonicalFeatureKey,
    );
    if (!res.allowed) {
      return {
        allowed: false,
        code: res.decision.code,
        plan: entitlements.plan,
        requiredPlan: res.decision.requiredPlan,
        isPaidActive: entitlements.isPaidActive,
        featureKey: check.featureKey,
        enabled: false,
        limit: null,
        unlimited: false,
        currentUsage,
        requestedAmount,
        upgradeUrl: res.decision.upgradeUrl,
        reason: res.decision.message,
      };
    }
    return {
      allowed: true,
      plan: entitlements.plan,
      isPaidActive: entitlements.isPaidActive,
      featureKey: check.featureKey,
      enabled: true,
      limit: null,
      unlimited: true,
      currentUsage,
      requestedAmount,
    };
  }

  if (check.featureKey in entitlements.quotas) {
    const res = checkQuotaAccess(
      entitlements,
      check.featureKey as CanonicalQuotaKey,
      currentUsage,
      requestedAmount,
    );
    if (!res.allowed) {
      return {
        allowed: false,
        code: res.decision.code,
        plan: entitlements.plan,
        requiredPlan: res.decision.requiredPlan,
        isPaidActive: entitlements.isPaidActive,
        featureKey: check.featureKey,
        enabled: res.decision.code !== "ZERO_QUOTA",
        limit: res.decision.limit,
        unlimited: false,
        currentUsage,
        requestedAmount,
        upgradeUrl: res.decision.upgradeUrl,
        reason: res.decision.message,
      };
    }
    return {
      allowed: true,
      plan: entitlements.plan,
      isPaidActive: entitlements.isPaidActive,
      featureKey: check.featureKey,
      enabled: true,
      limit: res.limit,
      unlimited: res.unlimited,
      currentUsage,
      requestedAmount,
    };
  }

  const entry = entitlements.features[
    check.featureKey as keyof EffectiveOrganizationEntitlements["features"]
  ] as {
    enabled: boolean;
    limit?: number | null;
    unlimited?: boolean;
  } | undefined;

  if (!entry || !entry.enabled) {
    return {
      allowed: false,
      code: "FEATURE_NOT_AVAILABLE",
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

  const isUnlimited =
    entry.unlimited === true || entry.limit === null || entry.limit === undefined;
  if (!isUnlimited && typeof entry.limit === "number") {
    if (currentUsage + requestedAmount > entry.limit) {
      return {
        allowed: false,
        code: entry.limit === 0 ? "ZERO_QUOTA" : "QUOTA_EXHAUSTED",
        plan: entitlements.plan,
        isPaidActive: entitlements.isPaidActive,
        featureKey: check.featureKey,
        enabled: entry.limit > 0,
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
