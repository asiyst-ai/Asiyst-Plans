export * from "./plans";

/**
 * Authoritative Plan Benefit Implementation & Verification Matrix
 *
 * Self-contained copy synchronized with `Asiyst-WEB/src/lib/billing/benefit-matrix.ts`
 * so `Asiyst-Plans` builds cleanly in standalone CI environments (e.g. Cloudflare Workers Builds).
 */

export type FeatureImplementationStatus =
  | "implemented_and_verified"
  | "implemented_not_deployed"
  | "partially_implemented"
  | "not_implemented"
  | "blocked_by_external_dependency"
  | "not_applicable";

export type FeatureVerificationResult = "pass" | "fail" | "blocked";

export interface PlanBenefitEntry {
  featureId: string;
  name: string;
  category:
    | "Workspace & Projects"
    | "AI Assistant"
    | "3D Avatars"
    | "Knowledge & Crawling"
    | "Analytics: Revenue"
    | "Analytics: Visitors"
    | "Analytics: Journeys"
    | "Analytics: Commerce"
    | "Analytics: SEO"
    | "Analytics: Marketing"
    | "Analytics: Assistant"
    | "Analytics: Health"
    | "Analytics: Insights & Opportunities"
    | "Analytics: Reports & Exports"
    | "Branding & Enterprise"
    | "SDK & Integrations"
    | "AI Billing & BYOK";
  plans: {
    zero: boolean;
    pulse: boolean;
    vector: boolean;
    quantum: boolean;
  };
  frontendRoute: string;
  backendApi: string;
  databaseDependency: string;
  requiredEntitlement: string;
  usageLimits: {
    zero: string;
    pulse: string;
    vector: string;
    quantum: string;
  };
  implementationStatus: FeatureImplementationStatus;
  testCoverage: string;
  verificationResult: FeatureVerificationResult;
  notes?: string;
}

export const PLAN_BENEFIT_MATRIX: PlanBenefitEntry[] = [
  // 1. Workspace & Projects
  {
    featureId: "projects.management",
    name: "Active Projects",
    category: "Workspace & Projects",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/projects",
    backendApi: "/api/v1/projects",
    databaseDependency: "projects",
    requiredEntitlement: "projects.max_count",
    usageLimits: { zero: "1 project", pulse: "3 projects", vector: "10 projects", quantum: "Unlimited (null)" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "workspaces.management",
    name: "Independent Workspaces",
    category: "Workspace & Projects",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/overview",
    backendApi: "/api/v1/workspaces",
    databaseDependency: "organizations",
    requiredEntitlement: "workspaces.max_count",
    usageLimits: { zero: "1 workspace", pulse: "1 workspace", vector: "2 workspaces", quantum: "10 workspaces" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "organization.seats",
    name: "Organization Seats & Team Members",
    category: "Workspace & Projects",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/settings",
    backendApi: "/api/v1/workspaces/[workspaceId]/members",
    databaseDependency: "organization_members",
    requiredEntitlement: "organization.max_members",
    usageLimits: { zero: "1 seat", pulse: "1 seat", vector: "3 seats", quantum: "10 seats" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "projects.advanced_management",
    name: "Portfolio Management, Cloning & Bulk Actions",
    category: "Workspace & Projects",
    plans: { zero: false, pulse: false, vector: false, quantum: true },
    frontendRoute: "/dashboard/projects",
    backendApi: "/api/v1/projects/portfolio",
    databaseDependency: "projects",
    requiredEntitlement: "projects.advanced_management",
    usageLimits: { zero: "No", pulse: "No", vector: "No", quantum: "Full Portfolio Controls" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },

  // 2. AI Website Assistant
  {
    featureId: "assistant.basic",
    name: "Core Website Assistant & Website Q&A",
    category: "AI Assistant",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/conversations",
    backendApi: "/api/v1/conversations/messages",
    databaseDependency: "conversations, messages",
    requiredEntitlement: "assistant.basic",
    usageLimits: { zero: "Standard", pulse: "Standard", vector: "Enhanced", quantum: "Enterprise" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "visitor.enhanced_interactions",
    name: "Proactive Guided Tours & Interactive Prompts",
    category: "AI Assistant",
    plans: { zero: false, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/connect/sdk",
    backendApi: "/api/v1/projects/[id]/tours",
    databaseDependency: "guided_tours",
    requiredEntitlement: "visitor.enhanced_interactions",
    usageLimits: { zero: "No", pulse: "Yes", vector: "Yes", quantum: "Yes" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },

  // 3. 3D Avatars
  {
    featureId: "avatar.built_in",
    name: "Built-in 3D Avatar Selection",
    category: "3D Avatars",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/avatar",
    backendApi: "/api/v1/avatars",
    databaseDependency: "avatars",
    requiredEntitlement: "avatar.basic",
    usageLimits: { zero: "Default avatar", pulse: "All built-in", vector: "All built-in", quantum: "All built-in" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "avatar.custom_upload",
    name: "Custom 3D Avatar Upload (.glb, .fbx, .zip)",
    category: "3D Avatars",
    plans: { zero: false, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/avatar/create",
    backendApi: "/api/v1/projects/[id]/avatars/upload-session",
    databaseDependency: "avatars, avatar_upload_sessions",
    requiredEntitlement: "avatar.custom_upload",
    usageLimits: { zero: "No", pulse: "Up to 5 uploads", vector: "Up to 25 uploads", quantum: "Unlimited" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "avatar.customization",
    name: "Avatar Studio & Appearance Customization",
    category: "3D Avatars",
    plans: { zero: false, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/avatar/customize",
    backendApi: "/api/v1/projects/[id]/avatar/runtime-config",
    databaseDependency: "avatars",
    requiredEntitlement: "avatar.customization",
    usageLimits: { zero: "Default style", pulse: "Full Studio", vector: "Full Studio", quantum: "Full Studio" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "avatar.policy_rules",
    name: "Avatar Behaviour & Policy Governance Rules",
    category: "3D Avatars",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/avatar/rules",
    backendApi: "/api/v1/projects/[id]/avatar/policy-rules",
    databaseDependency: "avatar_policy_rules",
    requiredEntitlement: "avatar.policy_rules",
    usageLimits: { zero: "No", pulse: "No", vector: "Advanced rules", quantum: "Enterprise rules" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },

  // 4. Knowledge & Crawling
  {
    featureId: "knowledge.basic",
    name: "Knowledge Management & Manual Ingestion",
    category: "Knowledge & Crawling",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/knowledge",
    backendApi: "/api/v1/projects/[id]/knowledge",
    databaseDependency: "knowledge_files, knowledge_entries",
    requiredEntitlement: "knowledge.basic",
    usageLimits: { zero: "3 files / 50 units", pulse: "5 files / 250 units", vector: "50 files / 2,000 units", quantum: "Unlimited (10GB fair-use)" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "crawl.pages",
    name: "Website Crawling & Automated Ingestion",
    category: "Knowledge & Crawling",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/knowledge/sitemap",
    backendApi: "/api/v1/projects/[id]/knowledge/sitemap",
    databaseDependency: "crawl_page_quota_reservations",
    requiredEntitlement: "knowledge.max_crawl_pages",
    usageLimits: { zero: "10 pages/mo", pulse: "100 pages/mo", vector: "1,000 pages/mo", quantum: "Unlimited (10,000/mo fair-use cap)" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "knowledge.scheduled_sync",
    name: "Scheduled Recurring Website Sync Jobs",
    category: "Knowledge & Crawling",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/knowledge/sync",
    backendApi: "/api/v1/projects/[id]/knowledge/schedules",
    databaseDependency: "knowledge_sync_schedules",
    requiredEntitlement: "knowledge.scheduled_sync",
    usageLimits: { zero: "0 jobs", pulse: "0 jobs", vector: "10 jobs", quantum: "50 jobs" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "knowledge.versioning",
    name: "Knowledge History & Snapshot Rollback",
    category: "Knowledge & Crawling",
    plans: { zero: false, pulse: false, vector: false, quantum: true },
    frontendRoute: "/dashboard/knowledge/activity",
    backendApi: "/api/v1/projects/[id]/versions",
    databaseDependency: "knowledge_versions",
    requiredEntitlement: "knowledge.versioning",
    usageLimits: { zero: "No", pulse: "No", vector: "No", quantum: "Full Versioning & Rollback" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },

  // 5. Analytics: Overview & Revenue
  {
    featureId: "analytics.overview.basic",
    name: "Analytics Overview & Core Metrics",
    category: "Analytics: Revenue",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics",
    backendApi: "/api/v1/projects/[id]/analytics",
    databaseDependency: "analytics_daily_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "7 days", pulse: "30 days", vector: "90 days", quantum: "365 days" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.revenue.basic",
    name: "Basic Conversion Count & Events",
    category: "Analytics: Revenue",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/revenue-conversion",
    backendApi: "/api/v1/projects/[id]/analytics/revenue",
    databaseDependency: "analytics_daily_aggregates",
    requiredEntitlement: "analytics.revenue.basic",
    usageLimits: { zero: "Basic counts", pulse: "Detailed trends", vector: "AOV & Funnels", quantum: "Full Attribution" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.revenue.advanced",
    name: "Conversion Rates, Checkout Funnels & AOV",
    category: "Analytics: Revenue",
    plans: { zero: false, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/revenue-conversion",
    backendApi: "/api/v1/projects/[id]/analytics/revenue",
    databaseDependency: "analytics_daily_aggregates",
    requiredEntitlement: "analytics.advanced",
    usageLimits: { zero: "Locked", pulse: "CR & summaries", vector: "Funnels & AOV", quantum: "Multi-touch Attribution" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },

  // 6. Analytics: Visitors & Journeys
  {
    featureId: "analytics.visitors.basic",
    name: "Visitor Intelligence (Visitors, Sessions, Device)",
    category: "Analytics: Visitors",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/visitors",
    backendApi: "/api/v1/projects/[id]/analytics/visitors",
    databaseDependency: "analytics_daily_aggregates, analytics_traffic_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Total counts", pulse: "Sources & devices", vector: "Behavioral segmentation", quantum: "Custom cohort segments" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.visitors.segmentation",
    name: "Visitor Behavioral Segmentation & Scroll Milestones",
    category: "Analytics: Visitors",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/visitors",
    backendApi: "/api/v1/projects/[id]/analytics/visitors",
    databaseDependency: "analytics_daily_aggregates",
    requiredEntitlement: "analytics.conversion",
    usageLimits: { zero: "Locked", pulse: "Locked", vector: "Segment analysis", quantum: "Advanced cohort retention" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.journeys.basic",
    name: "Customer Journeys & Navigation Paths",
    category: "Analytics: Journeys",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/customer-journeys",
    backendApi: "/api/v1/projects/[id]/analytics/customer-journeys",
    databaseDependency: "analytics_page_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Top paths", pulse: "Entry/exit flows", vector: "Conversion funnels", quantum: "Multi-step journey attribution" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.journeys.advanced",
    name: "Multi-Step Conversion Funnels & Drop-off Analysis",
    category: "Analytics: Journeys",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/customer-journeys",
    backendApi: "/api/v1/projects/[id]/analytics/customer-journeys",
    databaseDependency: "analytics_page_aggregates",
    requiredEntitlement: "analytics.conversion",
    usageLimits: { zero: "Locked", pulse: "Locked", vector: "Full Funnels", quantum: "Cross-source journey attribution" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },

  // 7. Analytics: Commerce, SEO & Marketing
  {
    featureId: "analytics.commerce.basic",
    name: "Commerce Views & Product Interactions",
    category: "Analytics: Commerce",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/commerce",
    backendApi: "/api/v1/projects/[id]/analytics/commerce",
    databaseDependency: "analytics_daily_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Basic counts", pulse: "Add-to-cart trends", vector: "Demand & checkout analysis", quantum: "Deep inventory analysis" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.seo.basic",
    name: "SEO Organic Traffic & Top Landing Pages",
    category: "Analytics: SEO",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/seo",
    backendApi: "/api/v1/projects/[id]/analytics/seo",
    databaseDependency: "analytics_traffic_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Organic summary", pulse: "Top queries & CTR", vector: "Keyword opportunity analysis", quantum: "Historical SEO rank comparisons" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.marketing.basic",
    name: "Marketing Channels & Campaign Acquisition",
    category: "Analytics: Marketing",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/marketing",
    backendApi: "/api/v1/projects/[id]/analytics/marketing",
    databaseDependency: "analytics_traffic_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Channel breakdown", pulse: "Campaign summaries", vector: "Channel comparisons & CPA", quantum: "Advanced CAC & ROAS attribution" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },

  // 8. Analytics: Assistant & Website Health
  {
    featureId: "analytics.assistant.basic",
    name: "AI Assistant Usage & Dialogue Metrics",
    category: "Analytics: Assistant",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/assistant",
    backendApi: "/api/v1/projects/[id]/analytics/assistant",
    databaseDependency: "analytics_assistant_aggregates",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Total dialogs", pulse: "Resolution & latency", vector: "Intent & knowledge gaps", quantum: "Provider/Model outcome analysis" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.health.basic",
    name: "Website Health & Tracking Integrity",
    category: "Analytics: Health",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/health",
    backendApi: "/api/v1/projects/[id]/analytics/health",
    databaseDependency: "analytics_tracking_settings",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Status & failures", pulse: "JS & avatar errors", vector: "Core Web Vitals", quantum: "Full Error & Performance impact" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.health.advanced",
    name: "Core Web Vitals (LCP, INP, CLS) & Performance Diagnostics",
    category: "Analytics: Health",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/health",
    backendApi: "/api/v1/projects/[id]/analytics/health",
    databaseDependency: "analytics_daily_aggregates",
    requiredEntitlement: "analytics.advanced",
    usageLimits: { zero: "Locked", pulse: "Locked", vector: "Web Vitals", quantum: "Detailed Diagnostics & Impact" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },

  // 9. Intelligence: AI Insights & Opportunities
  {
    featureId: "analytics.insights.basic",
    name: "AI Performance Insights & Knowledge Gaps",
    category: "Analytics: Insights & Opportunities",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/ai-insights",
    backendApi: "/api/v1/projects/[id]/analytics/insights",
    databaseDependency: "analytics_insights",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Basic summaries", pulse: "Evidence recommendations", vector: "Cross-category opportunities", quantum: "Custom AI strategic analysis" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.opportunities.basic",
    name: "Opportunity Center & Lifecycle Management",
    category: "Analytics: Insights & Opportunities",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/opportunities",
    backendApi: "/api/v1/projects/[id]/analytics/opportunities",
    databaseDependency: "analytics_opportunities",
    requiredEntitlement: "analytics.basic",
    usageLimits: { zero: "Core items", pulse: "Detailed opportunities", vector: "Advanced lifecycle actions", quantum: "Strategic opportunity center" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },

  // 10. Reports & Exports
  {
    featureId: "analytics.exports.csv",
    name: "CSV Data Exports",
    category: "Analytics: Reports & Exports",
    plans: { zero: false, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/reports",
    backendApi: "/api/v1/projects/[id]/analytics/reports",
    databaseDependency: "analytics_reports",
    requiredEntitlement: "analytics.export",
    usageLimits: { zero: "No exports", pulse: "CSV export", vector: "CSV & JSON export", quantum: "Full scheduled exports" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "analytics.exports.pdf",
    name: "Custom Executive Reports (PDF & JSON)",
    category: "Analytics: Reports & Exports",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/analytics/reports",
    backendApi: "/api/v1/projects/[id]/analytics/reports",
    databaseDependency: "analytics_reports",
    requiredEntitlement: "analytics.export",
    usageLimits: { zero: "No", pulse: "CSV only", vector: "Custom reports & JSON/PDF", quantum: "Automated recurring schedules" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-analytics-platform.test.ts",
    verificationResult: "pass",
  },

  // 11. Enterprise & Branding
  {
    featureId: "branding.whitelabel",
    name: "Standard White-Label (Remove Asiyst Branding)",
    category: "Branding & Enterprise",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/projects/[id]/branding",
    backendApi: "/api/v1/projects/[id]/branding",
    databaseDependency: "projects",
    requiredEntitlement: "branding.whitelabel",
    usageLimits: { zero: "Asiyst badge", pulse: "Asiyst badge", vector: "Custom badge / removed", quantum: "Full custom domain white-label" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "branding.full_whitelabel",
    name: "Full Whitelabel & Custom Domains",
    category: "Branding & Enterprise",
    plans: { zero: false, pulse: false, vector: false, quantum: true },
    frontendRoute: "/dashboard/projects/[id]/branding",
    backendApi: "/api/v1/projects/[id]/branding",
    databaseDependency: "projects",
    requiredEntitlement: "branding.full_whitelabel",
    usageLimits: { zero: "No", pulse: "No", vector: "No", quantum: "Full Whitelabel" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "advanced_permissions",
    name: "Granular Team Role-Based Access Control (RBAC)",
    category: "Branding & Enterprise",
    plans: { zero: false, pulse: false, vector: false, quantum: true },
    frontendRoute: "/dashboard/settings",
    backendApi: "/api/v1/workspaces/[workspaceId]/members",
    databaseDependency: "organization_members",
    requiredEntitlement: "advanced_permissions",
    usageLimits: { zero: "Owner only", pulse: "Owner only", vector: "Standard roles", quantum: "Custom granular permissions" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "webhooks",
    name: "Outbound Webhooks Integration",
    category: "Branding & Enterprise",
    plans: { zero: false, pulse: false, vector: true, quantum: true },
    frontendRoute: "/dashboard/settings/api-keys",
    backendApi: "/api/v1/projects/[id]/webhooks",
    databaseDependency: "webhooks",
    requiredEntitlement: "webhooks",
    usageLimits: { zero: "No", pulse: "No", vector: "Active webhooks", quantum: "High-volume webhooks" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },

  // 12. SDK & Integrations
  {
    featureId: "sdk.access",
    name: "Client SDK & CLI Access",
    category: "SDK & Integrations",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/connect/sdk",
    backendApi: "/api/v1/cli/whoami",
    databaseDependency: "api_keys",
    requiredEntitlement: "sdk.access",
    usageLimits: { zero: "Full SDK", pulse: "Full SDK", vector: "Full SDK", quantum: "Full SDK & Custom endpoints" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-sdk-package-consistency.ts",
    verificationResult: "pass",
  },
  {
    featureId: "integrations.shopify",
    name: "Shopify Store Integration",
    category: "SDK & Integrations",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/connect/shopify",
    backendApi: "/api/v1/connect/shopify/status",
    databaseDependency: "shopify_connections",
    requiredEntitlement: "core.platform",
    usageLimits: { zero: "1 store", pulse: "1 store", vector: "Multiple stores", quantum: "Enterprise stores" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
  {
    featureId: "integrations.wordpress",
    name: "WordPress Plugin Integration",
    category: "SDK & Integrations",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/connect/wordpress",
    backendApi: "/api/v1/connect/wordpress/approve",
    databaseDependency: "wordpress_connections",
    requiredEntitlement: "core.platform",
    usageLimits: { zero: "1 site", pulse: "1 site", vector: "Multiple sites", quantum: "Unlimited sites" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },

  // 13. AI Billing & BYOK
  {
    featureId: "ai.byok",
    name: "Bring Your Own Key (BYOK) AI Keys",
    category: "AI Billing & BYOK",
    plans: { zero: true, pulse: true, vector: true, quantum: true },
    frontendRoute: "/dashboard/ai/settings",
    backendApi: "/api/v1/ai/pricing",
    databaseDependency: "user_api_keys",
    requiredEntitlement: "ai.byok",
    usageLimits: { zero: "Unlimited BYOK", pulse: "Unlimited BYOK", vector: "Unlimited BYOK", quantum: "Unlimited BYOK" },
    implementationStatus: "implemented_and_verified",
    testCoverage: "scripts/verify-complete-subscription-platform.test.ts",
    verificationResult: "pass",
  },
];
