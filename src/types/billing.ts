export type OfficialPlanSlug = "zero" | "pulse" | "vector" | "quantum";
export type LegacyPlanSlug = "free" | "starter" | "pro" | "plus" | "business" | "apex" | "enterprise";
export type AnyPlanSlug = OfficialPlanSlug | LegacyPlanSlug;
export type PaidPlanSlug = "pulse" | "vector" | "quantum";

export type SubscriptionLifecycleStatus =
  | "free"
  | "pending"
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "cancellation_scheduled"
  | "canceled"
  | "cancelled"
  | "expired"
  | "payment_failed"
  | "incomplete";

export type OrganizationMemberRole =
  | "owner"
  | "admin"
  | "manager"
  | "editor"
  | "member"
  | "viewer";

export type CanonicalFeatureKey =
  | "assistant.basic"
  | "assistant.website_qa"
  | "avatar.chat"
  | "avatar.custom_upload"
  | "avatar.studio"
  | "avatar.customization"
  | "avatar.advanced"
  | "visitor.enhanced_interactions"
  | "knowledge.basic"
  | "knowledge.advanced"
  | "knowledge.sync"
  | "knowledge.scheduled_sync"
  | "knowledge.versioning"
  | "analytics.basic"
  | "analytics.advanced"
  | "analytics.conversion"
  | "analytics.export"
  | "analytics.multi_project"
  | "analytics.cohort"
  | "analytics.ai_summary"
  | "analytics.anomaly_detection"
  | "analytics.overview.basic"
  | "analytics.revenue.basic"
  | "analytics.revenue.advanced"
  | "analytics.visitors.basic"
  | "analytics.visitors.segmentation"
  | "analytics.journeys.basic"
  | "analytics.journeys.advanced"
  | "analytics.commerce.basic"
  | "analytics.commerce.advanced"
  | "analytics.seo.basic"
  | "analytics.seo.advanced"
  | "analytics.marketing.basic"
  | "analytics.marketing.advanced"
  | "analytics.assistant.basic"
  | "analytics.assistant.advanced"
  | "analytics.health.basic"
  | "analytics.health.advanced"
  | "analytics.insights.basic"
  | "analytics.insights.advanced"
  | "analytics.opportunities.basic"
  | "analytics.opportunities.advanced"
  | "analytics.reports.basic"
  | "analytics.reports.custom"
  | "analytics.exports.csv"
  | "analytics.exports.pdf"
  | "analytics.exports.xlsx"
  | "branding.whitelabel"
  | "branding.full_whitelabel"
  | "advanced_permissions"
  | "projects.advanced_management";

export type CanonicalQuotaKey =
  | "projects"
  | "workspaces"
  | "organization_seats"
  | "assistants"
  | "knowledge_files"
  | "knowledge_entries"
  | "knowledge_units"
  | "knowledge_storage_bytes"
  | "crawl_pages"
  | "scheduled_sync_jobs"
  | "analytics_history_days";

export interface BillingProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  status: "active" | "draft" | "archived";
}

export interface PlanFeatureLimits {
  /** Maximum owned workspaces across account */
  workspaces: number;
  /** Maximum active projects per workspace (null = unlimited) */
  projects: number | null;
  /** Maximum organization seats */
  organizationSeats: number;
  /** AI Assistants per project */
  assistants: number;
  /** Maximum uploaded knowledge files (null = unlimited) */
  knowledgeFiles: number | null;
  /** Manual knowledge entries limit (null = unlimited) */
  knowledgeEntries: number | null;
  /** Total indexed knowledge quota units per project (null = unlimited) */
  knowledgeUnits: number | null;
  /** Knowledge storage bytes limit (fair-use cap on top tier) */
  knowledgeStorageBytes: number | null;
  /** Processed website crawl pages per billing period (null = unlimited with fair-use cap) */
  crawlPages: number | null;
  /** Documented fair-use cap when crawlPages is unlimited */
  crawlFairUseCap: number;
  /** Maximum scheduled sync sources per workspace */
  scheduledSyncJobs: number;
  /** Historical analytics retention in days (7, 30, 90, 365) */
  analyticsHistoryDays?: number;
}

export interface OfficialPlanDefinition {
  id: string;
  productSlug: string;
  slug: OfficialPlanSlug;
  dbSlug: "free" | "starter" | "pro" | "business";
  historicalBaselineName: string;
  name: string;
  badge?: string;
  highlight?: boolean;
  subtitle: string;
  description: string;
  priceMinor: number; // Integer minor units (cents) — NEVER float
  currency: "USD";
  billingInterval: "none" | "month";
  requiresDodoCheckout: boolean;
  aiCreditsIncluded: 0; // Strict rule: NO subscription plan includes AI Credits
  limits: PlanFeatureLimits;
  capabilities: Record<CanonicalFeatureKey, boolean>;
  capabilityMatrix: {
    websiteCrawling: string;
    websiteIndexing: "Basic" | "Advanced";
    scheduledRecrawling: boolean;
    indexMonitoring: boolean;
    customWelcome: "Basic" | "Yes";
    customAppearance: "Basic" | "Yes";
    activityLogs: "Basic" | "Yes" | "Advanced";
    analytics: "Basic" | "Advanced";
    advancedReporting: boolean;
    avatarCapabilities: "Basic Assistant" | "Avatar Chat & Custom Upload" | "Advanced Avatar" | "Full Avatar Studio";
    avatarStudio: boolean;
    customAvatarUpload: boolean;
    animations: "Default" | "Standard" | "Advanced";
    collaboration: "Single user" | "Single workspace" | "Multi-seat" | "Advanced RBAC";
    multipleIntegrations: "Standard" | "Standard" | "Expanded" | "Enterprise";
    auditHistory: "Basic" | "Standard" | "Standard" | "Full + Versioning";
    advancedPermissions: "Basic" | "Basic" | "Role-based" | "Granular RBAC";
    organizationManagement: boolean;
    asiystBrandingVisible: boolean;
    whiteLabelTier: "None" | "None" | "Standard" | "Full Enterprise";
    support: "Self-service" | "Email" | "Priority";
  };
  benefitGroups: Array<{
    category: string;
    items: string[];
  }>;
}

export interface EntitlementFeatureEntry {
  enabled: boolean;
  limit?: number | null;
  unlimited?: boolean;
  fairUseCap?: number | null;
  resetPeriod?: "none" | "billing_period" | "monthly";
  tier?: string;
}

export interface EntitlementAccessError {
  code:
    | "FEATURE_NOT_AVAILABLE"
    | "ZERO_QUOTA"
    | "QUOTA_EXHAUSTED"
    | "SUBSCRIPTION_EXPIRED"
    | "BILLING_FAILURE";
  httpStatus: 402 | 403 | 429;
  feature: string;
  currentPlan: OfficialPlanSlug;
  requiredPlan: OfficialPlanSlug;
  subscriptionStatus: SubscriptionLifecycleStatus;
  limit: number | null;
  currentUsage: number;
  upgradeUrl: string;
  message: string;
}

export interface EffectiveOrganizationEntitlements {
  organizationId: string;
  product: "asiyst-ai";
  plan: OfficialPlanSlug;
  dbPlanKey: "free" | "starter" | "pro" | "business";
  subscriptionId: string | null;
  status: SubscriptionLifecycleStatus;
  isPaidActive: boolean;
  isInGracePeriod: boolean;
  isExpired: boolean;
  hasBillingFailure: boolean;
  cancelAtPeriodEnd: boolean;
  scheduledPlan: OfficialPlanSlug | null;
  scheduledChangeEffectiveAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  resetPeriod: "monthly" | "billing_period";
  aiCreditsIncluded: 0;
  capabilities: Record<CanonicalFeatureKey, boolean>;
  quotas: Record<
    CanonicalQuotaKey,
    {
      limit: number | null;
      unlimited: boolean;
      fairUseCap?: number | null;
      used?: number;
      remaining?: number | null;
      resetPeriod: "none" | "monthly" | "billing_period";
    }
  >;
  features: {
    workspaces: { enabled: boolean; limit: number | null; unlimited: boolean };
    projects: { enabled: boolean; limit: number | null; unlimited: boolean };
    organization_seats: { enabled: boolean; limit: number | null; unlimited: boolean };
    assistants: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_files: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_entries: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_units: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_storage_bytes: { enabled: boolean; limit: number | null; unlimited: boolean };
    crawl_pages: {
      enabled: boolean;
      limit: number | null;
      unlimited: boolean;
      fairUseCap: number;
      resetPeriod: "monthly" | "billing_period";
    };
    scheduled_sync_jobs: { enabled: boolean; limit: number | null; unlimited: boolean };
    website_crawling: { enabled: boolean; tier: string };
    website_indexing: { enabled: boolean; tier: string };
    scheduled_crawling: { enabled: boolean };
    index_monitoring: { enabled: boolean };
    custom_welcome: { enabled: boolean; tier: string };
    custom_appearance: { enabled: boolean; tier: string };
    activity_logs: { enabled: boolean; tier: string };
    basic_analytics: { enabled: boolean };
    advanced_analytics: { enabled: boolean };
    conversion_analytics: { enabled: boolean };
    analytics_export: { enabled: boolean };
    multi_project_analytics: { enabled: boolean };
    cohort_analytics: { enabled: boolean };
    ai_analytics_summary: { enabled: boolean };
    anomaly_detection: { enabled: boolean };
    advanced_reporting: { enabled: boolean };
    built_in_avatars: { enabled: boolean };
    avatar_chat: { enabled: boolean };
    custom_avatar_upload: { enabled: boolean };
    advanced_avatar_capabilities: { enabled: boolean };
    avatar_studio: { enabled: boolean };
    advanced_animations: { enabled: boolean };
    enhanced_visitor_interactions: { enabled: boolean };
    team_collaboration: { enabled: boolean };
    multiple_integrations: { enabled: boolean };
    audit_history: { enabled: boolean };
    knowledge_versioning: { enabled: boolean };
    advanced_permissions: { enabled: boolean };
    organization_management: { enabled: boolean };
    advanced_project_management: { enabled: boolean };
    remove_asiyst_branding: { enabled: boolean };
    full_whitelabel: { enabled: boolean };
    support_tier: { enabled: boolean; tier: string };
  };
}

export type BillingEmailEventType =
  | "billing.subscription.activated"
  | "billing.subscription.welcome"
  | "billing.subscription.plan_upgraded"
  | "billing.subscription.plan_downgraded"
  | "billing.cancellation.requested"
  | "billing.cancellation.reversed"
  | "billing.subscription.canceled"
  | "billing.subscription.expiring"
  | "billing.subscription.reactivated"
  | "billing.subscription.renewed"
  | "billing.trial.started"
  | "billing.trial.ending"
  | "billing.payment.succeeded"
  | "billing.payment.failed"
  | "billing.payment.retry_scheduled"
  | "billing.payment.recovered"
  | "billing.subscription.past_due"
  | "billing.payment.final_warning"
  | "billing.payment.refunded"
  | "billing.payment.dispute"
  | "billing.invoice.available"
  | "billing.details.updated"
  | "billing.contact.changed"
  | "billing.contact.verification"
  | "billing.admin.invited"
  | "billing.admin.role_changed"
  | "billing.usage.limit_approaching"
  | "billing.usage.limit_reached"
  | "billing.sync.issue";
