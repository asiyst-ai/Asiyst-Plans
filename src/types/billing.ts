export type OfficialPlanSlug = "zero" | "pulse" | "vector" | "quantum";
export type LegacyPlanSlug = "free" | "starter" | "pro" | "business";
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

export type OrganizationMemberRole = "owner" | "admin" | "member";

export interface BillingProduct {
  id: string;
  slug: string;
  name: string;
  description: string;
  logoUrl: string | null;
  status: "active" | "draft" | "archived";
}

export interface PlanFeatureLimits {
  /** Number of organizations (null = not configured / account policy) */
  organizations: number | "account_policy" | "unconfigured";
  /** Maximum active projects covered by organization subscription */
  projects: number | "unconfigured";
  /** Maximum organization seats */
  organizationSeats: number | "unconfigured";
  /** AI Assistants per project */
  assistants: number | "unconfigured";
  /** Maximum knowledge files (number, 'unlimited', or 'basic') */
  knowledgeFiles: number | "unlimited" | "basic";
  /** Manual knowledge entries limit (null = unlimited) */
  knowledgeEntries: number | null;
  /** Knowledge storage bytes limit (null = unlimited) */
  knowledgeStorageBytes: number | null;
}

export interface OfficialPlanDefinition {
  id: string;
  productSlug: string;
  slug: OfficialPlanSlug;
  dbSlug: LegacyPlanSlug;
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
  capabilityMatrix: {
    websiteCrawling: "Basic context" | "Yes" | "Advanced";
    websiteIndexing: "Basic" | "Yes" | "Advanced";
    scheduledRecrawling: boolean;
    indexMonitoring: boolean;
    customWelcome: "Basic" | "Yes";
    customAppearance: "Basic" | "Yes";
    activityLogs: "Basic" | "Yes" | "Advanced";
    analytics: "Basic" | "Advanced";
    advancedReporting: boolean;
    avatarCapabilities: "Basic" | "Standard" | "Advanced" | "Avatar Studio";
    avatarStudio: boolean;
    customAvatarUpload: boolean;
    animations: "Default" | "Advanced capabilities" | "Advanced";
    collaboration: "Basic" | "Yes" | "Advanced";
    multipleIntegrations: "Basic" | "Existing configuration" | "Yes" | "Advanced";
    auditHistory: "Basic" | "Existing configuration" | "Yes";
    advancedPermissions: "Basic" | "Existing configuration" | "Yes";
    organizationManagement: boolean;
    asiystBrandingVisible: boolean;
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
  tier?: string;
}

export interface EffectiveOrganizationEntitlements {
  organizationId: string;
  product: "asiyst-ai";
  plan: OfficialPlanSlug;
  dbPlanKey: LegacyPlanSlug;
  subscriptionId: string | null;
  status: SubscriptionLifecycleStatus;
  isPaidActive: boolean;
  isInGracePeriod: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  aiCreditsIncluded: 0;
  features: {
    projects: { enabled: boolean; limit: number | null; unlimited: boolean };
    organization_seats: { enabled: boolean; limit: number | null; unlimited: boolean };
    assistants: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_files: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_entries: { enabled: boolean; limit: number | null; unlimited: boolean };
    knowledge_storage_bytes: { enabled: boolean; limit: number | null; unlimited: boolean };
    website_crawling: { enabled: boolean; tier: string };
    website_indexing: { enabled: boolean; tier: string };
    scheduled_crawling: { enabled: boolean };
    index_monitoring: { enabled: boolean };
    custom_welcome: { enabled: boolean; tier: string };
    custom_appearance: { enabled: boolean; tier: string };
    activity_logs: { enabled: boolean; tier: string };
    basic_analytics: { enabled: boolean };
    advanced_analytics: { enabled: boolean };
    advanced_reporting: { enabled: boolean };
    built_in_avatars: { enabled: boolean };
    custom_avatar_upload: { enabled: boolean };
    advanced_avatar_capabilities: { enabled: boolean };
    avatar_studio: { enabled: boolean };
    advanced_animations: { enabled: boolean };
    team_collaboration: { enabled: boolean };
    multiple_integrations: { enabled: boolean };
    audit_history: { enabled: boolean };
    advanced_permissions: { enabled: boolean };
    organization_management: { enabled: boolean };
    remove_asiyst_branding: { enabled: boolean };
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
  | "billing.admin.invited"
  | "billing.admin.role_changed"
  | "billing.usage.limit_approaching"
  | "billing.usage.limit_reached"
  | "billing.sync.issue";
