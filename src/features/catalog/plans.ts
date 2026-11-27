import type {
  CanonicalFeatureKey,
  OfficialPlanDefinition,
  OfficialPlanSlug,
  PaidPlanSlug,
} from "../../types/billing";

/**
 * Authoritative Asiyst Four-Tier Subscription Catalog (Phase 00)
 *
 * Historical Audited Baseline -> Canonical Commercial Product Mapping:
 * - Asiyst Zero ($0/mo)      -> Asiyst Zero (`zero`, legacy DB slug `free`)
 * - Asiyst Pro  ($24/mo)     -> Asiyst Pulse (`pulse`, legacy DB slug `starter`)
 * - Asiyst Plus ($54/mo)     -> Asiyst Vector (`vector`, legacy DB slug `pro` / `plus`)
 * - Asiyst Vector ($154/mo)  -> Asiyst Quantum (`quantum`, legacy DB slug `business` / `enterprise` / `apex`)
 *
 * Fair-Use & Unlimited Governance Policy:
 * - Quantum Projects: Unlimited (`null`), governed only by platform anti-abuse rate limits.
 * - Quantum Knowledge Files / Entries / Units: Unlimited (`null`), with 10 GB storage fair-use safeguard.
 * - Quantum Website Crawling: Unlimited (`null`), governed by a documented 10,000 processed pages/period fair-use safeguard.
 * - AI Credits: Strictly 0 across all subscription plans (managed separately via BYOK or credit packs).
 */
export const HISTORICAL_PLAN_MAPPING = {
  "Asiyst Zero": "zero",
  "Asiyst Pro": "pulse",
  "Asiyst Plus": "vector",
  "Asiyst Vector (Legacy Top Tier)": "quantum",
} as const;

export const OFFICIAL_PLANS: Record<OfficialPlanSlug, OfficialPlanDefinition> = {
  zero: {
    id: "plan_asiyst_zero",
    productSlug: "asiyst-ai",
    slug: "zero",
    dbSlug: "free",
    historicalBaselineName: "Asiyst Zero",
    name: "Asiyst Zero",
    subtitle: "Free foundation · 1 project, 1 workspace & core website assistant",
    description:
      "Get started free with 1 project, 1 workspace, a basic AI website assistant, website-context Q&A, basic knowledge management (up to 3 files, 50 entries, 10 crawled pages/month), and basic analytics.",
    priceMinor: 0,
    currency: "USD",
    billingInterval: "none",
    requiresDodoCheckout: false,
    aiCreditsIncluded: 0,
    limits: {
      workspaces: 1,
      projects: 1,
      organizationSeats: 1,
      assistants: 1,
      knowledgeFiles: 3,
      knowledgeEntries: 50,
      knowledgeUnits: 50,
      knowledgeStorageBytes: 10 * 1024 * 1024, // 10 MB
      crawlPages: 10,
      crawlFairUseCap: 10,
      scheduledSyncJobs: 0,
      analyticsHistoryDays: 7,
    },
    capabilities: {
      "assistant.basic": true,
      "assistant.website_qa": true,
      "avatar.chat": false,
      "avatar.custom_upload": false,
      "avatar.studio": false,
      "avatar.customization": false,
      "avatar.advanced": false,
      "visitor.enhanced_interactions": false,
      "knowledge.basic": true,
      "knowledge.advanced": false,
      "knowledge.sync": false,
      "knowledge.scheduled_sync": false,
      "knowledge.versioning": false,
      "analytics.basic": true,
      "analytics.advanced": false,
      "analytics.conversion": false,
      "analytics.export": false,
      "analytics.multi_project": false,
      "analytics.cohort": false,
      "analytics.ai_summary": false,
      "analytics.anomaly_detection": false,
      "analytics.overview.basic": true,
      "analytics.revenue.basic": true,
      "analytics.revenue.advanced": false,
      "analytics.visitors.basic": true,
      "analytics.visitors.segmentation": false,
      "analytics.journeys.basic": true,
      "analytics.journeys.advanced": false,
      "analytics.commerce.basic": true,
      "analytics.commerce.advanced": false,
      "analytics.seo.basic": true,
      "analytics.seo.advanced": false,
      "analytics.marketing.basic": true,
      "analytics.marketing.advanced": false,
      "analytics.assistant.basic": true,
      "analytics.assistant.advanced": false,
      "analytics.health.basic": true,
      "analytics.health.advanced": false,
      "analytics.insights.basic": true,
      "analytics.insights.advanced": false,
      "analytics.opportunities.basic": true,
      "analytics.opportunities.advanced": false,
      "analytics.reports.basic": true,
      "analytics.reports.custom": false,
      "analytics.exports.csv": false,
      "analytics.exports.pdf": false,
      "analytics.exports.xlsx": false,
      "branding.whitelabel": false,
      "branding.full_whitelabel": false,
      "advanced_permissions": false,
      "projects.advanced_management": false,
    },
    capabilityMatrix: {
      websiteCrawling: "Up to 10 pages/mo",
      websiteIndexing: "Basic",
      scheduledRecrawling: false,
      indexMonitoring: false,
      customWelcome: "Basic",
      customAppearance: "Basic",
      activityLogs: "Basic",
      analytics: "Basic",
      advancedReporting: false,
      avatarCapabilities: "Basic Assistant",
      avatarStudio: false,
      customAvatarUpload: false,
      animations: "Default",
      collaboration: "Single user",
      multipleIntegrations: "Standard",
      auditHistory: "Basic",
      advancedPermissions: "Basic",
      organizationManagement: false,
      asiystBrandingVisible: true,
      whiteLabelTier: "None",
      support: "Self-service",
    },
    benefitGroups: [
      {
        category: "Workspace & Projects",
        items: [
          "1 workspace & 1 project",
          "1 organization seat",
          "SDK & CLI website integration",
        ],
      },
      {
        category: "Assistant & Knowledge",
        items: [
          "Basic AI website assistant & website Q&A",
          "Basic knowledge management (up to 3 files & 50 entries)",
          "Website crawling up to 10 pages/month",
        ],
      },
      {
        category: "Analytics & Support",
        items: [
          "Basic visitor, session & conversation analytics",
          "Bring Your Own Key (BYOK) AI support",
          "Self-service documentation (Asiyst branding visible)",
        ],
      },
    ],
  },
  pulse: {
    id: "plan_asiyst_pulse",
    productSlug: "asiyst-ai",
    slug: "pulse",
    dbSlug: "starter",
    historicalBaselineName: "Asiyst Pro",
    name: "Asiyst Pulse",
    subtitle: "Growing websites · 3 projects, avatar chat, custom uploads & 100-page crawling",
    description:
      "Everything in Zero plus up to 3 projects, interactive 3D avatar-based chat, custom 3D avatar uploads, 100-page website crawling, advanced knowledge & on-demand sync, enhanced visitor interactions, and advanced analytics.",
    priceMinor: 2400,
    currency: "USD",
    billingInterval: "month",
    requiresDodoCheckout: true,
    aiCreditsIncluded: 0,
    limits: {
      workspaces: 1,
      projects: 3,
      organizationSeats: 1,
      assistants: 1,
      knowledgeFiles: 5,
      knowledgeEntries: 250,
      knowledgeUnits: 250,
      knowledgeStorageBytes: 100 * 1024 * 1024, // 100 MB
      crawlPages: 100,
      crawlFairUseCap: 100,
      scheduledSyncJobs: 0,
      analyticsHistoryDays: 30,
    },
    capabilities: {
      "assistant.basic": true,
      "assistant.website_qa": true,
      "avatar.chat": true,
      "avatar.custom_upload": true,
      "avatar.studio": true,
      "avatar.customization": true,
      "avatar.advanced": false,
      "visitor.enhanced_interactions": true,
      "knowledge.basic": true,
      "knowledge.advanced": true,
      "knowledge.sync": true,
      "knowledge.scheduled_sync": false,
      "knowledge.versioning": false,
      "analytics.basic": true,
      "analytics.advanced": true,
      "analytics.conversion": false,
      "analytics.export": false,
      "analytics.multi_project": false,
      "analytics.cohort": false,
      "analytics.ai_summary": false,
      "analytics.anomaly_detection": false,
      "analytics.overview.basic": true,
      "analytics.revenue.basic": true,
      "analytics.revenue.advanced": true,
      "analytics.visitors.basic": true,
      "analytics.visitors.segmentation": false,
      "analytics.journeys.basic": true,
      "analytics.journeys.advanced": false,
      "analytics.commerce.basic": true,
      "analytics.commerce.advanced": false,
      "analytics.seo.basic": true,
      "analytics.seo.advanced": false,
      "analytics.marketing.basic": true,
      "analytics.marketing.advanced": false,
      "analytics.assistant.basic": true,
      "analytics.assistant.advanced": true,
      "analytics.health.basic": true,
      "analytics.health.advanced": false,
      "analytics.insights.basic": true,
      "analytics.insights.advanced": false,
      "analytics.opportunities.basic": true,
      "analytics.opportunities.advanced": false,
      "analytics.reports.basic": true,
      "analytics.reports.custom": false,
      "analytics.exports.csv": true,
      "analytics.exports.pdf": false,
      "analytics.exports.xlsx": false,
      "branding.whitelabel": false,
      "branding.full_whitelabel": false,
      "advanced_permissions": false,
      "projects.advanced_management": false,
    },
    capabilityMatrix: {
      websiteCrawling: "Up to 100 pages/mo",
      websiteIndexing: "Advanced",
      scheduledRecrawling: false,
      indexMonitoring: false,
      customWelcome: "Yes",
      customAppearance: "Yes",
      activityLogs: "Yes",
      analytics: "Advanced",
      advancedReporting: false,
      avatarCapabilities: "Avatar Chat & Custom Upload",
      avatarStudio: true,
      customAvatarUpload: true,
      animations: "Standard",
      collaboration: "Single workspace",
      multipleIntegrations: "Standard",
      auditHistory: "Standard",
      advancedPermissions: "Basic",
      organizationManagement: false,
      asiystBrandingVisible: true,
      whiteLabelTier: "None",
      support: "Email",
    },
    benefitGroups: [
      {
        category: "Everything in Asiyst Zero, plus:",
        items: [
          "Up to 3 projects in 1 workspace",
          "Avatar-based 3D AI chat & custom avatar uploads (.glb / .fbx / .zip)",
          "Avatar appearance customization & proactive visitor interactions",
        ],
      },
      {
        category: "Advanced Knowledge",
        items: [
          "Up to 5 knowledge files & 250 knowledge units",
          "Website crawling up to 100 pages/month",
          "Advanced knowledge indexing & on-demand sync",
        ],
      },
      {
        category: "Analytics & Support",
        items: [
          "Advanced traffic, top-pages, device & assistant analytics",
          "Activity logs & email support",
        ],
      },
    ],
  },
  vector: {
    id: "plan_asiyst_vector",
    productSlug: "asiyst-ai",
    slug: "vector",
    dbSlug: "pro",
    historicalBaselineName: "Asiyst Plus",
    name: "Asiyst Vector",
    badge: "Most Popular",
    highlight: true,
    subtitle: "Scaling teams · 10 projects, 2 workspaces, scheduled sync & white-label",
    description:
      "Scale across up to 10 projects and 2 workspaces with 3 team seats, 50 knowledge files, 1,000-page crawling, scheduled synchronization, conversion funnel analytics, CSV/JSON exports, and standard white-label.",
    priceMinor: 5400,
    currency: "USD",
    billingInterval: "month",
    requiresDodoCheckout: true,
    aiCreditsIncluded: 0,
    limits: {
      workspaces: 2,
      projects: 10,
      organizationSeats: 3,
      assistants: 1,
      knowledgeFiles: 50,
      knowledgeEntries: 2000,
      knowledgeUnits: 2000,
      knowledgeStorageBytes: 1024 * 1024 * 1024, // 1 GB
      crawlPages: 1000,
      crawlFairUseCap: 1000,
      scheduledSyncJobs: 10,
      analyticsHistoryDays: 90,
    },
    capabilities: {
      "assistant.basic": true,
      "assistant.website_qa": true,
      "avatar.chat": true,
      "avatar.custom_upload": true,
      "avatar.studio": true,
      "avatar.customization": true,
      "avatar.advanced": true,
      "visitor.enhanced_interactions": true,
      "knowledge.basic": true,
      "knowledge.advanced": true,
      "knowledge.sync": true,
      "knowledge.scheduled_sync": true,
      "knowledge.versioning": false,
      "analytics.basic": true,
      "analytics.advanced": true,
      "analytics.conversion": true,
      "analytics.export": true,
      "analytics.multi_project": false,
      "analytics.cohort": false,
      "analytics.ai_summary": false,
      "analytics.anomaly_detection": false,
      "analytics.overview.basic": true,
      "analytics.revenue.basic": true,
      "analytics.revenue.advanced": true,
      "analytics.visitors.basic": true,
      "analytics.visitors.segmentation": true,
      "analytics.journeys.basic": true,
      "analytics.journeys.advanced": true,
      "analytics.commerce.basic": true,
      "analytics.commerce.advanced": true,
      "analytics.seo.basic": true,
      "analytics.seo.advanced": true,
      "analytics.marketing.basic": true,
      "analytics.marketing.advanced": true,
      "analytics.assistant.basic": true,
      "analytics.assistant.advanced": true,
      "analytics.health.basic": true,
      "analytics.health.advanced": true,
      "analytics.insights.basic": true,
      "analytics.insights.advanced": true,
      "analytics.opportunities.basic": true,
      "analytics.opportunities.advanced": true,
      "analytics.reports.basic": true,
      "analytics.reports.custom": true,
      "analytics.exports.csv": true,
      "analytics.exports.pdf": true,
      "analytics.exports.xlsx": true,
      "branding.whitelabel": true,
      "branding.full_whitelabel": false,
      "advanced_permissions": false,
      "projects.advanced_management": false,
    },
    capabilityMatrix: {
      websiteCrawling: "Up to 1,000 pages/mo",
      websiteIndexing: "Advanced",
      scheduledRecrawling: true,
      indexMonitoring: true,
      customWelcome: "Yes",
      customAppearance: "Yes",
      activityLogs: "Yes",
      analytics: "Advanced",
      advancedReporting: false,
      avatarCapabilities: "Advanced Avatar",
      avatarStudio: true,
      customAvatarUpload: true,
      animations: "Advanced",
      collaboration: "Multi-seat",
      multipleIntegrations: "Expanded",
      auditHistory: "Standard",
      advancedPermissions: "Role-based",
      organizationManagement: false,
      asiystBrandingVisible: false,
      whiteLabelTier: "Standard",
      support: "Priority",
    },
    benefitGroups: [
      {
        category: "Scale & Workspaces",
        items: [
          "Up to 10 projects across up to 2 workspaces",
          "Up to 3 team seats per workspace",
          "Standard white-label (remove Asiyst branding)",
        ],
      },
      {
        category: "Automated Website Intelligence",
        items: [
          "Up to 50 knowledge files & 1,000 crawled pages/month",
          "Scheduled recurring website & sitemap synchronization",
          "Index health monitoring & advanced policy rules",
        ],
      },
      {
        category: "Conversion & Data Portability",
        items: [
          "Conversion funnel analytics",
          "CSV & JSON analytics data export",
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
    historicalBaselineName: "Asiyst Vector (Legacy Top Tier)",
    name: "Asiyst Quantum",
    badge: "Full Scale",
    subtitle: "Enterprise portfolio · Unlimited projects, 10 workspaces, AI intelligence & RBAC",
    description:
      "Unlimited projects, up to 10 workspaces, 10 seats, unlimited knowledge files, fair-use unlimited crawling, cross-project & cohort analytics, AI summaries, anomaly detection, version history & rollback, advanced RBAC, and full white-label.",
    priceMinor: 15400,
    currency: "USD",
    billingInterval: "month",
    requiresDodoCheckout: true,
    aiCreditsIncluded: 0,
    limits: {
      workspaces: 10,
      projects: null, // Genuinely unlimited (governed by platform anti-abuse safeguards)
      organizationSeats: 10,
      assistants: 1,
      knowledgeFiles: null, // Unlimited
      knowledgeEntries: null, // Unlimited
      knowledgeUnits: null, // Unlimited
      knowledgeStorageBytes: 10 * 1024 * 1024 * 1024, // 10 GB fair-use policy
      crawlPages: null, // Unlimited governed by 10,000 pages/period fair-use safeguard
      crawlFairUseCap: 10000,
      scheduledSyncJobs: 50,
      analyticsHistoryDays: 365,
    },
    capabilities: {
      "assistant.basic": true,
      "assistant.website_qa": true,
      "avatar.chat": true,
      "avatar.custom_upload": true,
      "avatar.studio": true,
      "avatar.customization": true,
      "avatar.advanced": true,
      "visitor.enhanced_interactions": true,
      "knowledge.basic": true,
      "knowledge.advanced": true,
      "knowledge.sync": true,
      "knowledge.scheduled_sync": true,
      "knowledge.versioning": true,
      "analytics.basic": true,
      "analytics.advanced": true,
      "analytics.conversion": true,
      "analytics.export": true,
      "analytics.multi_project": true,
      "analytics.cohort": true,
      "analytics.ai_summary": true,
      "analytics.anomaly_detection": true,
      "analytics.overview.basic": true,
      "analytics.revenue.basic": true,
      "analytics.revenue.advanced": true,
      "analytics.visitors.basic": true,
      "analytics.visitors.segmentation": true,
      "analytics.journeys.basic": true,
      "analytics.journeys.advanced": true,
      "analytics.commerce.basic": true,
      "analytics.commerce.advanced": true,
      "analytics.seo.basic": true,
      "analytics.seo.advanced": true,
      "analytics.marketing.basic": true,
      "analytics.marketing.advanced": true,
      "analytics.assistant.basic": true,
      "analytics.assistant.advanced": true,
      "analytics.health.basic": true,
      "analytics.health.advanced": true,
      "analytics.insights.basic": true,
      "analytics.insights.advanced": true,
      "analytics.opportunities.basic": true,
      "analytics.opportunities.advanced": true,
      "analytics.reports.basic": true,
      "analytics.reports.custom": true,
      "analytics.exports.csv": true,
      "analytics.exports.pdf": true,
      "analytics.exports.xlsx": true,
      "branding.whitelabel": true,
      "branding.full_whitelabel": true,
      "advanced_permissions": true,
      "projects.advanced_management": true,
    },
    capabilityMatrix: {
      websiteCrawling: "Unlimited (10,000/mo fair-use)",
      websiteIndexing: "Advanced",
      scheduledRecrawling: true,
      indexMonitoring: true,
      customWelcome: "Yes",
      customAppearance: "Yes",
      activityLogs: "Advanced",
      analytics: "Advanced",
      advancedReporting: true,
      avatarCapabilities: "Full Avatar Studio",
      avatarStudio: true,
      customAvatarUpload: true,
      animations: "Advanced",
      collaboration: "Advanced RBAC",
      multipleIntegrations: "Enterprise",
      auditHistory: "Full + Versioning",
      advancedPermissions: "Granular RBAC",
      organizationManagement: true,
      asiystBrandingVisible: false,
      whiteLabelTier: "Full Enterprise",
      support: "Priority",
    },
    benefitGroups: [
      {
        category: "Unlimited Portfolio & Workspaces",
        items: [
          "Unlimited projects & up to 10 independent workspaces",
          "Up to 10 organization seats & advanced portfolio management",
          "Unlimited knowledge files & unlimited website crawling (fair-use)",
        ],
      },
      {
        category: "Executive Intelligence Suite",
        items: [
          "Cross-project analytics & visitor retention cohorts",
          "AI-generated analytics summaries & statistical anomaly detection",
        ],
      },
      {
        category: "Enterprise Governance & Full White-Label",
        items: [
          "Complete version history & rollback (knowledge, avatar & policies)",
          "Granular RBAC permissions across workspaces and projects",
          "Full white-label branding & custom assistant attribution",
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
 * Deterministic canonical & legacy plan slug resolver.
 * Supports: 'zero', 'free', 'pulse', 'starter', 'vector', 'pro', 'plus',
 * 'quantum', 'business', 'apex', 'enterprise'.
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
    case "plus":
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

export function getMinimumPlanForCapability(
  capability: CanonicalFeatureKey,
): OfficialPlanSlug {
  for (const planSlug of ["zero", "pulse", "vector", "quantum"] as OfficialPlanSlug[]) {
    if (OFFICIAL_PLANS[planSlug].capabilities[capability]) {
      return planSlug;
    }
  }
  return "quantum";
}

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
    key: "projects",
    feature: "Projects",
    category: "Workspace & Portfolio",
    values: {
      zero: { display: "1" },
      pulse: { display: "3" },
      vector: { display: "10" },
      quantum: { display: "Unlimited" },
    },
  },
  {
    key: "workspaces",
    feature: "Workspaces",
    category: "Workspace & Portfolio",
    values: {
      zero: { display: "1" },
      pulse: { display: "1" },
      vector: { display: "2" },
      quantum: { display: "10" },
    },
  },
  {
    key: "organization_seats",
    feature: "Team seats per workspace",
    category: "Workspace & Portfolio",
    values: {
      zero: { display: "1" },
      pulse: { display: "1" },
      vector: { display: "3" },
      quantum: { display: "10" },
    },
  },
  {
    key: "avatar_chat",
    feature: "Avatar-based AI chat",
    category: "3D Avatar & Assistant",
    values: {
      zero: { display: "Basic assistant only" },
      pulse: { display: "Yes" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "custom_avatar_upload",
    feature: "Custom 3D avatar uploads",
    category: "3D Avatar & Assistant",
    values: {
      zero: { display: "No" },
      pulse: { display: "Yes" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "website_crawling",
    feature: "Website crawling",
    category: "Knowledge & Synchronization",
    values: {
      zero: { display: "10 pages/mo" },
      pulse: { display: "100 pages/mo" },
      vector: { display: "1,000 pages/mo" },
      quantum: { display: "Unlimited (fair-use)" },
    },
  },
  {
    key: "knowledge_files",
    feature: "Knowledge files & indexing",
    category: "Knowledge & Synchronization",
    values: {
      zero: { display: "Basic (3 files)" },
      pulse: { display: "Advanced (5 files)" },
      vector: { display: "Advanced (50 files)" },
      quantum: { display: "Unlimited" },
    },
  },
  {
    key: "scheduled_sync",
    feature: "Scheduled synchronization",
    category: "Knowledge & Synchronization",
    values: {
      zero: { display: "No" },
      pulse: { display: "On-demand only" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "analytics_advanced",
    feature: "Advanced analytics",
    category: "Analytics & Intelligence",
    values: {
      zero: { display: "Basic" },
      pulse: { display: "Yes" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "analytics_conversion_export",
    feature: "Conversion funnel & CSV/JSON export",
    category: "Analytics & Intelligence",
    values: {
      zero: { display: "No" },
      pulse: { display: "No" },
      vector: { display: "Yes" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "analytics_executive",
    feature: "Cross-project, Cohort, AI Summary & Anomalies",
    category: "Analytics & Intelligence",
    values: {
      zero: { display: "No" },
      pulse: { display: "No" },
      vector: { display: "No" },
      quantum: { display: "Yes" },
    },
  },
  {
    key: "whitelabel",
    feature: "White-label branding",
    category: "Branding & Governance",
    values: {
      zero: { display: "No" },
      pulse: { display: "No" },
      vector: { display: "Standard" },
      quantum: { display: "Full white-label" },
    },
  },
  {
    key: "versioning_rbac",
    feature: "Version history, Advanced RBAC & Portfolio tools",
    category: "Branding & Governance",
    values: {
      zero: { display: "No" },
      pulse: { display: "No" },
      vector: { display: "No" },
      quantum: { display: "Yes" },
    },
  },
];
