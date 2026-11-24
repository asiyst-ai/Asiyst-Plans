import type {
  OfficialPlanDefinition,
  OfficialPlanSlug,
  PaidPlanSlug,
} from "@/types/billing";

/**
 * Authoritative Asiyst Plan Catalog
 *
 * Strictly enforces:
 * - Zero: $0/month (0 minor units USD)
 * - Pulse: $24/month (2400 minor units USD)
 * - Vector: $54/month (5400 minor units USD)
 * - Quantum: $154/month (15400 minor units USD)
 * - NO AI Credits included in any subscription plan.
 * - Integer minor-unit monetary representation only.
 */
export const OFFICIAL_PLANS: Record<OfficialPlanSlug, OfficialPlanDefinition> = {
  zero: {
    id: "plan_asiyst_zero",
    productSlug: "asiyst-ai",
    slug: "zero",
    dbSlug: "free",
    name: "Asiyst Zero",
    subtitle: "Free foundation · 1 project & core 3D website assistant",
    description:
      "Get started with our core AI website assistant, built-in 3D avatars, standard SDK website integration, and basic knowledge support.",
    priceMinor: 0,
    currency: "USD",
    billingInterval: "none",
    requiresDodoCheckout: false,
    aiCreditsIncluded: 0,
    limits: {
      organizations: 1,
      projects: 1,
      organizationSeats: 1,
      assistants: 1,
      knowledgeFiles: "basic",
      knowledgeEntries: 50,
      knowledgeStorageBytes: 10 * 1024 * 1024, // 10 MB from existing authoritative migration
    },
    capabilityMatrix: {
      websiteCrawling: "Basic context",
      websiteIndexing: "Basic",
      scheduledRecrawling: false,
      indexMonitoring: false,
      customWelcome: "Basic",
      customAppearance: "Basic",
      activityLogs: "Basic",
      analytics: "Basic",
      advancedReporting: false,
      avatarCapabilities: "Basic",
      avatarStudio: false,
      customAvatarUpload: false,
      animations: "Default",
      collaboration: "Basic",
      multipleIntegrations: "Basic",
      auditHistory: "Basic",
      advancedPermissions: "Basic",
      organizationManagement: false,
      asiystBrandingVisible: true,
      support: "Self-service",
    },
    benefitGroups: [
      {
        category: "Organization & Access",
        items: [
          "1 organization",
          "1 project",
          "1 organization seat",
          "1 AI assistant",
        ],
      },
      {
        category: "AI Website Assistant",
        items: [
          "Basic AI website assistant",
          "Website-context-based question answering",
          "Custom assistant name & basic instructions",
          "Basic welcome message & conversation handling",
        ],
      },
      {
        category: "3D Avatar & Website Integration",
        items: [
          "Access to built-in 3D avatars & default animations",
          "Basic website & SDK integration capabilities",
          "Basic knowledge functionality & sitemap support",
          "Standard self-service support (Asiyst branding visible)",
        ],
      },
    ],
  },
  pulse: {
    id: "plan_asiyst_pulse",
    productSlug: "asiyst-ai",
    slug: "pulse",
    dbSlug: "starter",
    name: "Asiyst Pulse",
    subtitle: "Individuals & small websites · Custom appearance & knowledge indexing",
    description:
      "Includes the Zero foundation plus up to 5 knowledge files, website crawling and indexing, custom assistant appearance, activity logs, and email support.",
    priceMinor: 2400,
    currency: "USD",
    billingInterval: "month",
    requiresDodoCheckout: true,
    aiCreditsIncluded: 0,
    limits: {
      organizations: "unconfigured",
      projects: 1, // Authoritative in Asiyst-WEB plan-catalog.ts & assign_project_organization trigger
      organizationSeats: 1, // Authoritative in enforce_organization_seat_limit trigger
      assistants: "unconfigured",
      knowledgeFiles: 5,
      knowledgeEntries: null,
      knowledgeStorageBytes: null,
    },
    capabilityMatrix: {
      websiteCrawling: "Yes",
      websiteIndexing: "Yes",
      scheduledRecrawling: false,
      indexMonitoring: false,
      customWelcome: "Yes",
      customAppearance: "Yes",
      activityLogs: "Yes",
      analytics: "Basic",
      advancedReporting: false,
      avatarCapabilities: "Standard",
      avatarStudio: false,
      customAvatarUpload: true,
      animations: "Default",
      collaboration: "Basic",
      multipleIntegrations: "Existing configuration",
      auditHistory: "Existing configuration",
      advancedPermissions: "Existing configuration",
      organizationManagement: false,
      asiystBrandingVisible: true,
      support: "Email",
    },
    benefitGroups: [
      {
        category: "Everything in Asiyst Zero, plus:",
        items: [
          "Support for up to 5 knowledge files",
          "Website crawling & website indexing",
        ],
      },
      {
        category: "Assistant Customization",
        items: [
          "Custom welcome message",
          "Custom assistant appearance",
        ],
      },
      {
        category: "Monitoring & Support",
        items: [
          "Activity logs & basic analytics",
          "Email support",
        ],
      },
    ],
  },
  vector: {
    id: "plan_asiyst_vector",
    productSlug: "asiyst-ai",
    slug: "vector",
    dbSlug: "pro",
    name: "Asiyst Vector",
    badge: "Most Popular",
    highlight: true,
    subtitle: "Growing teams · Up to 3 projects, 3 seats & scheduled recrawling",
    description:
      "Scale across up to 3 projects and 3 organization seats with 50 knowledge files, advanced crawling, scheduled recrawling, index monitoring, and priority support.",
    priceMinor: 5400,
    currency: "USD",
    billingInterval: "month",
    requiresDodoCheckout: true,
    aiCreditsIncluded: 0,
    limits: {
      organizations: "unconfigured",
      projects: 3,
      organizationSeats: 3,
      assistants: "unconfigured",
      knowledgeFiles: 50,
      knowledgeEntries: null,
      knowledgeStorageBytes: null,
    },
    capabilityMatrix: {
      websiteCrawling: "Advanced",
      websiteIndexing: "Advanced",
      scheduledRecrawling: true,
      indexMonitoring: true,
      customWelcome: "Yes",
      customAppearance: "Yes",
      activityLogs: "Yes",
      analytics: "Advanced",
      advancedReporting: false,
      avatarCapabilities: "Advanced",
      avatarStudio: false,
      customAvatarUpload: true,
      animations: "Advanced capabilities",
      collaboration: "Yes",
      multipleIntegrations: "Yes",
      auditHistory: "Existing configuration",
      advancedPermissions: "Existing configuration",
      organizationManagement: false,
      asiystBrandingVisible: false,
      support: "Priority",
    },
    benefitGroups: [
      {
        category: "Organization & Scale",
        items: [
          "Up to 3 projects",
          "Up to 3 organization seats",
        ],
      },
      {
        category: "Knowledge & Website Intelligence",
        items: [
          "Up to 50 knowledge files & advanced knowledge capabilities",
          "Advanced crawling and indexing",
          "Scheduled recrawling & index monitoring",
        ],
      },
      {
        category: "Avatar, Analytics & Collaboration",
        items: [
          "Advanced avatar capabilities",
          "Advanced analytics",
          "Team collaboration & multiple integrations",
          "Priority support",
        ],
      },
    ],
  },
  quantum: {
    id: "plan_asiyst_quantum",
    productSlug: "asiyst-ai",
    slug: "quantum",
    dbSlug: "business",
    name: "Asiyst Quantum",
    badge: "Full Scale",
    subtitle: "Full organization scale · 10 projects, 10 seats & Avatar Studio",
    description:
      "Complete organizational capacity with up to 10 projects, 10 organization seats, unlimited knowledge files, Avatar Studio, advanced reporting, audit history, and advanced permissions.",
    priceMinor: 15400,
    currency: "USD",
    billingInterval: "month",
    requiresDodoCheckout: true,
    aiCreditsIncluded: 0,
    limits: {
      organizations: "account_policy",
      projects: 10,
      organizationSeats: 10,
      assistants: "unconfigured",
      knowledgeFiles: "unlimited",
      knowledgeEntries: null,
      knowledgeStorageBytes: null,
    },
    capabilityMatrix: {
      websiteCrawling: "Advanced",
      websiteIndexing: "Advanced",
      scheduledRecrawling: true,
      indexMonitoring: true,
      customWelcome: "Yes",
      customAppearance: "Yes",
      activityLogs: "Advanced",
      analytics: "Advanced",
      advancedReporting: true,
      avatarCapabilities: "Avatar Studio",
      avatarStudio: true,
      customAvatarUpload: true,
      animations: "Advanced",
      collaboration: "Advanced",
      multipleIntegrations: "Advanced",
      auditHistory: "Yes",
      advancedPermissions: "Yes",
      organizationManagement: true,
      asiystBrandingVisible: false,
      support: "Priority",
    },
    benefitGroups: [
      {
        category: "Organization & Unlimited Knowledge",
        items: [
          "Up to 10 projects",
          "Up to 10 organization seats",
          "Unlimited knowledge files",
        ],
      },
      {
        category: "Avatar Studio & Analytics",
        items: [
          "Access to Avatar Studio & advanced avatar management",
          "Avatar customization & animation capabilities",
          "Advanced analytics & advanced reporting",
        ],
      },
      {
        category: "Administration & Governance",
        items: [
          "Audit history",
          "Advanced permissions & organization management",
          "Priority support",
        ],
      },
    ],
  },
};

export const OFFICIAL_PLAN_LIST: OfficialPlanDefinition[] = [
  OFFICIAL_PLANS.zero,
  OFFICIAL_PLANS.pulse,
  OFFICIAL_PLANS.vector,
  OFFICIAL_PLANS.quantum,
];

const PLAN_TIER_RANK: Record<OfficialPlanSlug, number> = {
  zero: 0,
  pulse: 1,
  vector: 2,
  quantum: 3,
};

/**
 * Normalizes any database or legacy plan identifier ('free', 'zero', 'starter', 'pulse', etc.)
 * to the canonical Asiyst Plan key ('zero', 'pulse', 'vector', 'quantum').
 */
export function normalizeOfficialPlanSlug(
  raw: string | null | undefined,
): OfficialPlanSlug | null {
  if (!raw) return null;
  const cleaned = raw.trim().toLowerCase();
  switch (cleaned) {
    case "zero":
    case "free":
      return "zero";
    case "pulse":
    case "starter":
      return "pulse";
    case "vector":
    case "pro":
      return "vector";
    case "quantum":
    case "business":
    case "apex":
    case "enterprise":
      return "quantum";
    default:
      return null;
  }
}

export function isPaidPlanSlug(slug: OfficialPlanSlug): slug is PaidPlanSlug {
  return slug === "pulse" || slug === "vector" || slug === "quantum";
}

export function comparePlanRank(a: OfficialPlanSlug, b: OfficialPlanSlug): number {
  return PLAN_TIER_RANK[a] - PLAN_TIER_RANK[b];
}

/**
 * Formats integer minor units (e.g. 2400) into display currency string (e.g. "$24")
 * without floating-point rounding bugs.
 */
export function formatMinorCurrency(
  amountMinor: number,
  currency: string = "USD",
  showCentsWhenZero: boolean = false,
): string {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new Error("Monetary amount must be an integer in minor units.");
  }
  const sign = amountMinor < 0 ? "-" : "";
  const abs = Math.abs(amountMinor);
  const major = Math.floor(abs / 100);
  const minor = abs % 100;
  const symbol = currency.toUpperCase() === "USD" ? "$" : `${currency.toUpperCase()} `;

  if (minor === 0 && !showCentsWhenZero) {
    return `${sign}${symbol}${major.toLocaleString("en-US")}`;
  }
  return `${sign}${symbol}${major.toLocaleString("en-US")}.${String(minor).padStart(2, "0")}`;
}

export interface ComparisonRow {
  key: string;
  feature: string;
  category: string;
  values: Record<OfficialPlanSlug, { display: string; isInternalState?: boolean }>;
}

/**
 * Dynamic Plan Comparison Rows matching Section 3.6 specification.
 * Note: Internal unconfigured states are flagged with `isInternalState: true` so public
 * marketing UI renders clean authoritative copy while admin sees exact configuration state.
 */
export const PLAN_COMPARISON_ROWS: ComparisonRow[] = [
  {
    key: "monthly_price",
    feature: "Monthly price",
    category: "Pricing",
    values: {
      zero: { display: "$0" },
      pulse: { display: "$24" },
      vector: { display: "$54" },
      quantum: { display: "$154" },
    },
  },
  {
    key: "organizations",
    feature: "Organizations",
    category: "Organization & Access",
    values: {
      zero: { display: "1" },
      pulse: { display: "1 workspace", isInternalState: true },
      vector: { display: "1 workspace", isInternalState: true },
      quantum: { display: "Account policy" },
    },
  },
  {
    key: "projects",
    feature: "Projects",
    category: "Organization & Access",
    values: {
      zero: { display: "1" },
      pulse: { display: "1" },
      vector: { display: "3" },
      quantum: { display: "10" },
    },
  },
  {
    key: "organization_seats",
    feature: "Organization seats",
    category: "Organization & Access",
    values: {
      zero: { display: "1" },
      pulse: { display: "1" },
      vector: { display: "3" },
      quantum: { display: "10" },
    },
  },
  {
    key: "assistants",
    feature: "Assistants",
    category: "Organization & Access",
    values: {
      zero: { display: "1" },
      pulse: { display: "1 per project", isInternalState: true },
      vector: { display: "1 per project", isInternalState: true },
      quantum: { display: "1 per project", isInternalState: true },
    },
  },
  {
    key: "knowledge_files",
    feature: "Knowledge files",
    category: "Knowledge & Website Intelligence",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "5" },
      vector: { display: "50" },
      quantum: { display: "Unlimited" },
    },
  },
  {
    key: "website_crawling",
    feature: "Website crawling",
    category: "Knowledge & Website Intelligence",
    values: {
      zero: { display: "Basic context" },
      pulse: { display: "Yes" },
      vector: { display: "Advanced" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "website_indexing",
    feature: "Website indexing",
    category: "Knowledge & Website Intelligence",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Yes" },
      vector: { display: "Advanced" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "custom_welcome",
    feature: "Custom welcome",
    category: "Assistant Customization",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Yes" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "custom_appearance",
    feature: "Custom appearance",
    category: "Assistant Customization",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Yes" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "activity_logs",
    feature: "Activity logs",
    category: "Monitoring & Analytics",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Yes" },
      vector: { display: "Yes" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "analytics",
    feature: "Analytics",
    category: "Monitoring & Analytics",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Basic" },
      vector: { display: "Advanced" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "avatar_capabilities",
    feature: "Avatar capabilities",
    category: "3D Avatar & Studio",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Standard" },
      vector: { display: "Advanced" },
      quantum: { display: "Avatar Studio" },
    },
  },
  {
    key: "animations",
    feature: "Animations",
    category: "3D Avatar & Studio",
    values: {
      zero: { display: "Default" },
      pulse: { display: "Default" },
      vector: { display: "Advanced capabilities" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "collaboration",
    feature: "Collaboration",
    category: "Collaboration & Integrations",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Basic" },
      vector: { display: "Yes" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "multiple_integrations",
    feature: "Multiple integrations",
    category: "Collaboration & Integrations",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Standard", isInternalState: true },
      vector: { display: "Yes" },
      quantum: { display: "Advanced" },
    },
  },
  {
    key: "audit_history",
    feature: "Audit history",
    category: "Administration",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Basic", isInternalState: true },
      vector: { display: "Standard", isInternalState: true },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "advanced_permissions",
    feature: "Advanced permissions",
    category: "Administration",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Basic", isInternalState: true },
      vector: { display: "Standard", isInternalState: true },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "support",
    feature: "Support",
    category: "Support",
    values: {
      zero: { display: "Self-service" },
      pulse: { display: "Email" },
      vector: { display: "Priority" },
      quantum: { display: "Priority" },
    },
  },
];
