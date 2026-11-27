-- ============================================================================
-- Migration: 20261125100000_complete_subscription_platform_enforcement.sql
-- Project: Asiyst Plan (plan.asiyst.com) & Asiyst-WEB Unified Subscription Platform
-- Description:
--   1. Aligns canonical 4-tier subscription catalog (Zero, Pulse, Vector, Quantum)
--      across billing_plans, billing_features, billing_plan_features, and SQL helpers.
--   2. Hardens subscriptions RLS so client sessions can never self-grant plans.
--   3. Implements canonical plan & feature resolution in PostgreSQL including
--      scheduled downgrade boundary preservation and legacy slug normalization.
--   4. Enables multi-workspace ownership (removes UNIQUE(owner_id) on organizations)
--      with atomic per-plan workspace quota enforcement (1 / 1 / 2 / 10).
--   5. Updates atomic project quota trigger (1 / 3 / 10 / Unlimited on Quantum)
--      without blocking updates on existing projects after downgrades.
--   6. Repairs reserve_knowledge_quota_unit (removes broken 4-arg overload,
--      restores exact 3-arg contract with per-plan file, entry, unit, and storage quotas).
--   7. Adds atomic crawl page quota reservation ledger & RPCs (10 / 100 / 1000 / Unlimited fair-use).
--   8. Adds scheduled knowledge sync schema & atomic claim RPC.
--   9. Adds white-label branding config, team/project RBAC & invitations,
--      analytics anomalies & AI summary cache, version history tables,
--      project portfolio templates/folders/tags, and storage avatar upload entitlement RLS.
-- ============================================================================

-- ============================================================================
-- 1. NEW TABLES CREATED FIRST (for clean static dependency ordering)
-- ============================================================================

-- 1.1 Atomic Website Crawl Page Quota Reservations (Phases 04, 10, 32)
create table if not exists public.crawl_page_quota_reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  period_key text not null,
  page_url text not null,
  attempt_key text not null,
  status text not null default 'reserved' check (status in ('reserved', 'processed', 'released')),
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  released_at timestamptz,
  unique (organization_id, period_key, attempt_key)
);

create index if not exists crawl_page_quota_org_period_status_idx
  on public.crawl_page_quota_reservations(organization_id, period_key, status);
create index if not exists crawl_page_quota_project_idx
  on public.crawl_page_quota_reservations(project_id, created_at desc);

alter table public.crawl_page_quota_reservations enable row level security;
revoke all on public.crawl_page_quota_reservations from public, anon, authenticated;
grant all on public.crawl_page_quota_reservations to service_role;

-- 1.2 Knowledge Synchronization Schedules (Phase 17)
create table if not exists public.knowledge_sync_schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null unique references public.knowledge_sources(id) on delete cascade,
  enabled boolean not null default true,
  frequency text not null default 'daily' check (frequency in ('hourly', 'every_6h', 'daily', 'weekly')),
  next_run_at timestamptz not null default (now() + interval '1 day'),
  last_run_at timestamptz,
  last_status text check (last_status in ('idle', 'queued', 'running', 'succeeded', 'failed', 'paused_entitlement')),
  consecutive_failures integer not null default 0,
  last_error text,
  claimed_at timestamptz,
  claimed_by text,
  idempotency_token text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists knowledge_sync_schedules_due_idx
  on public.knowledge_sync_schedules(enabled, next_run_at)
  where enabled = true;
create index if not exists knowledge_sync_schedules_project_idx
  on public.knowledge_sync_schedules(project_id);

alter table public.knowledge_sync_schedules enable row level security;

-- 1.3 Workspace & Project Member Invitations (Phases 21 & 29)
create table if not exists public.workspace_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  email text not null,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin', 'editor', 'viewer', 'member')),
  can_manage_billing boolean not null default false,
  permissions jsonb not null default '{}'::jsonb,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_by uuid references public.profiles(id) on delete set null,
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists workspace_invitations_org_status_idx
  on public.workspace_invitations(organization_id, status);
create index if not exists workspace_invitations_email_idx
  on public.workspace_invitations(lower(email), status);

alter table public.workspace_invitations enable row level security;

-- 1.4 Reusable Project Configuration Templates (Phase 31)
create table if not exists public.project_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  name text not null,
  description text not null default '',
  source_project_id uuid references public.projects(id) on delete set null,
  template_config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists project_templates_org_idx
  on public.project_templates(organization_id, created_at desc);

alter table public.project_templates enable row level security;

-- 1.5 Analytics Anomalies & AI Summary Cache (Phases 26 & 27)
create table if not exists public.analytics_anomalies (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  metric text not null,
  dimension text not null default 'overall',
  observed_value numeric not null,
  baseline_mean numeric not null,
  baseline_stddev numeric not null,
  z_score numeric not null,
  direction text not null check (direction in ('spike', 'drop')),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  window_days integer not null default 30,
  detected_for_date date not null,
  details jsonb not null default '{}'::jsonb,
  detected_at timestamptz not null default now(),
  unique (project_id, metric, dimension, detected_for_date)
);

create index if not exists analytics_anomalies_project_date_idx
  on public.analytics_anomalies(project_id, detected_for_date desc);

alter table public.analytics_anomalies enable row level security;

create table if not exists public.analytics_ai_summaries (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  period_days integer not null,
  data_fingerprint text not null,
  summary_text text not null,
  highlights jsonb not null default '[]'::jsonb,
  source_metrics jsonb not null default '{}'::jsonb,
  provider text,
  model_used text,
  generated_at timestamptz not null default now(),
  unique (project_id, period_days)
);

alter table public.analytics_ai_summaries enable row level security;

-- 1.6 Immutable Version History for Knowledge, Avatar, and Policy Configurations (Phase 28)
create table if not exists public.knowledge_item_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  item_type text not null check (item_type in ('file', 'entry', 'source')),
  item_id uuid not null,
  source_id uuid references public.knowledge_sources(id) on delete set null,
  version_number integer not null check (version_number >= 1),
  title text not null default '',
  content_text text not null default '',
  content_hash text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  source_reference text,
  created_by uuid references public.profiles(id) on delete set null,
  restored_from_version_id uuid references public.knowledge_item_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, item_type, item_id, version_number)
);

create index if not exists knowledge_item_versions_lookup_idx
  on public.knowledge_item_versions(project_id, item_type, item_id, version_number desc);

alter table public.knowledge_item_versions enable row level security;

create table if not exists public.configuration_versions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  resource_type text not null check (resource_type in ('avatar_config', 'policy_rules', 'branding_config', 'runtime_config')),
  resource_id text not null,
  version_number integer not null check (version_number >= 1),
  label text,
  snapshot jsonb not null default '{}'::jsonb,
  source_reference text,
  created_by uuid references public.profiles(id) on delete set null,
  restored_from_version_id uuid references public.configuration_versions(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (project_id, resource_type, resource_id, version_number)
);

create index if not exists configuration_versions_lookup_idx
  on public.configuration_versions(project_id, resource_type, resource_id, version_number desc);

alter table public.configuration_versions enable row level security;

-- ============================================================================
-- 2. EXTEND EXISTING TABLES SAFELY (BACKWARD COMPATIBLE)
-- ============================================================================

-- 2.1 Multi-workspace columns & removal of single-org owner_id unique constraint (Phases 15 & 23)
alter table public.organizations
  drop constraint if exists organizations_owner_id_key;
drop index if exists public.organizations_owner_id_key;

alter table public.organizations
  add column if not exists slug text,
  add column if not exists description text,
  add column if not exists is_personal boolean not null default false,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists organizations_owner_id_idx on public.organizations(owner_id, created_at asc);

-- Mark oldest owned workspace as personal if none marked yet
with earliest_org as (
  select distinct on (owner_id) id
  from public.organizations
  order by owner_id, created_at asc
)
update public.organizations o
set is_personal = true
from earliest_org e
where o.id = e.id
  and not exists (
    select 1 from public.organizations o2
    where o2.owner_id = o.owner_id and o2.is_personal = true
  );

-- 2.2 Remove legacy one-project-per-owner index if present & add portfolio columns (Phases 09, 20, 31)
drop index if exists public.projects_one_per_owner;
alter table public.projects
  drop constraint if exists projects_one_per_owner;

alter table public.projects
  add column if not exists folder text,
  add column if not exists tags text[] not null default '{}'::text[],
  add column if not exists archived_at timestamptz;

-- 2.3 Extend project_settings with white-label branding configuration (Phases 19 & 30)
alter table public.project_settings
  add column if not exists branding_config jsonb not null default '{}'::jsonb;

-- 2.4 Extend knowledge_sources with scheduling metadata (Phase 17)
alter table public.knowledge_sources
  add column if not exists sync_schedule_enabled boolean not null default false,
  add column if not exists sync_frequency text check (sync_frequency in ('hourly', 'every_6h', 'daily', 'weekly')),
  add column if not exists next_sync_at timestamptz,
  add column if not exists last_scheduled_sync_at timestamptz,
  add column if not exists sync_retry_count integer not null default 0,
  add column if not exists last_sync_error text,
  add column if not exists schedule_metadata jsonb not null default '{}'::jsonb;

-- 2.5 Extend organization_members & project_members for granular RBAC (Phases 21 & 29)
alter table public.organization_members
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.organization_members
  drop constraint if exists organization_members_role_check,
  add constraint organization_members_role_check
    check (role in ('owner', 'admin', 'editor', 'viewer', 'member'));

alter table public.project_members
  add column if not exists permissions jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table public.project_members
  drop constraint if exists project_members_role_check,
  add constraint project_members_role_check
    check (role in ('owner', 'admin', 'editor', 'viewer', 'member'));

-- 2.6 Subscriptions security & legacy 'plus' alias support (Phase 00 & Security)
alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check,
  add constraint subscriptions_plan_check
    check (plan in ('zero', 'free', 'pulse', 'starter', 'vector', 'pro', 'plus', 'quantum', 'business', 'enterprise', 'custom', 'apex'));

drop policy if exists "subscriptions_own" on public.subscriptions;
revoke insert, update, delete on public.subscriptions from anon, authenticated;

-- ============================================================================
-- 3. CANONICAL CATALOG SYNCHRONIZATION IN BILLING TABLES (Phase 00)
-- ============================================================================
do $$
declare
  v_product_id uuid;
  v_zero_id uuid;
  v_pulse_id uuid;
  v_vector_id uuid;
  v_quantum_id uuid;
begin
  select id into v_product_id from public.billing_products where slug = 'asiyst-ai' limit 1;
  if v_product_id is not null then
    update public.billing_plans
       set subtitle = 'Free foundation · 1 project, 1 workspace & core website assistant',
           description = 'Start free with 1 project, 1 workspace, basic AI website assistant, website Q&A, basic knowledge (up to 3 files, 50 entries, 10 crawled pages/mo), and basic analytics.',
           updated_at = now()
     where slug = 'zero';

    update public.billing_plans
       set subtitle = 'Growing sites · 3 projects, avatar chat, custom uploads & 100-page crawling',
           description = 'Unlock up to 3 projects, avatar-based AI chat, custom 3D avatar uploads, 100-page website crawling, advanced knowledge, on-demand sync, enhanced visitor interactions, and advanced analytics.',
           updated_at = now()
     where slug = 'pulse';

    update public.billing_plans
       set subtitle = 'Scaling teams · 10 projects, 2 workspaces, scheduled sync & white-label',
           description = 'Scale across up to 10 projects and 2 workspaces with 50 knowledge files, 1,000-page crawling, scheduled synchronization, conversion analytics, CSV/JSON analytics export, and standard white-label.',
           updated_at = now()
     where slug = 'vector';

    update public.billing_plans
       set subtitle = 'Enterprise scale · Unlimited projects, 10 workspaces, AI intelligence & RBAC',
           description = 'Complete platform scale with unlimited projects, up to 10 workspaces, 10 seats, cross-project & cohort analytics, AI summaries, anomaly detection, version history & rollback, advanced RBAC, and full white-label.',
           updated_at = now()
     where slug = 'quantum';

    insert into public.billing_features (product_id, feature_key, name, category, description, value_type, display_order)
    values
      (v_product_id, 'workspaces.max_count', 'Workspaces', 'Organization & Access', 'Maximum owned workspaces across account', 'numeric_limit', 1),
      (v_product_id, 'projects.max_count', 'Projects', 'Organization & Access', 'Maximum active projects per workspace', 'numeric_limit', 2),
      (v_product_id, 'organization.max_members', 'Organization seats', 'Organization & Access', 'Maximum team members in workspace', 'numeric_limit', 3),
      (v_product_id, 'crawl.max_pages', 'Website crawling pages', 'Knowledge & Website Intelligence', 'Monthly processed website crawl page allowance', 'numeric_limit', 6),
      (v_product_id, 'avatar.chat', 'Avatar-based AI chat', '3D Avatar & Studio', 'Interactive 3D avatar-driven visitor chat runtime', 'boolean', 13),
      (v_product_id, 'avatar.custom_upload', 'Custom avatar uploads', '3D Avatar & Studio', 'Upload custom GLB/FBX/ZIP 3D avatar models', 'boolean', 14),
      (v_product_id, 'knowledge.advanced', 'Advanced knowledge', 'Knowledge & Website Intelligence', 'Advanced ingestion, diagnostics, and indexing', 'boolean', 7),
      (v_product_id, 'knowledge.scheduled_sync', 'Scheduled synchronization', 'Knowledge & Website Intelligence', 'Automated recurring website & sitemap synchronization', 'boolean', 8),
      (v_product_id, 'analytics.advanced', 'Advanced analytics', 'Monitoring & Analytics', 'Detailed traffic sources, devices, top pages, and assistant performance', 'boolean', 12),
      (v_product_id, 'analytics.conversion', 'Conversion analytics', 'Monitoring & Analytics', 'Visitor-to-assistant multi-step conversion funnel', 'boolean', 20),
      (v_product_id, 'analytics.export', 'Analytics export', 'Monitoring & Analytics', 'CSV and JSON analytics report downloads', 'boolean', 21),
      (v_product_id, 'branding.whitelabel', 'Standard white-label', 'Branding', 'Remove standard Powered by Asiyst badge', 'boolean', 22),
      (v_product_id, 'analytics.multi_project', 'Cross-project analytics', 'Monitoring & Analytics', 'Workspace-wide combined project comparison analytics', 'boolean', 23),
      (v_product_id, 'analytics.cohort', 'Cohort analytics', 'Monitoring & Analytics', 'Visitor retention cohorts over time', 'boolean', 24),
      (v_product_id, 'analytics.ai_summary', 'AI analytics summaries', 'Monitoring & Analytics', 'Grounded AI-generated analytics executive insights', 'boolean', 25),
      (v_product_id, 'analytics.anomaly_detection', 'Anomaly detection', 'Monitoring & Analytics', 'Statistical spike and drop detection on real traffic', 'boolean', 26),
      (v_product_id, 'knowledge.versioning', 'Version history & rollback', 'Administration', 'Immutable snapshots and rollback for knowledge, avatar, and policies', 'boolean', 27),
      (v_product_id, 'advanced_permissions', 'Advanced RBAC', 'Administration', 'Granular role-based access control across workspaces and projects', 'boolean', 28),
      (v_product_id, 'branding.full_whitelabel', 'Full white-label', 'Branding', 'Custom brand attribution, custom domain, logo, and widget styling', 'boolean', 29),
      (v_product_id, 'projects.advanced_management', 'Advanced multi-project management', 'Organization & Access', 'Portfolio dashboard, folders, tags, cloning, templates, and bulk actions', 'boolean', 30)
    on conflict (feature_key) do update set
      name = excluded.name,
      category = excluded.category,
      description = excluded.description,
      value_type = excluded.value_type,
      updated_at = now();
  end if;
end;
$$;

-- ============================================================================
-- 4. CANONICAL SUBSCRIPTION & ENTITLEMENT SQL FUNCTIONS (Phases 00, 01, 32)
-- ============================================================================

create or replace function public.normalize_subscription_plan_slug(p_raw text)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select case lower(trim(coalesce(p_raw, '')))
    when 'zero' then 'zero'
    when 'free' then 'zero'
    when 'pulse' then 'pulse'
    when 'starter' then 'pulse'
    when 'vector' then 'vector'
    when 'pro' then 'vector'
    when 'plus' then 'vector'
    when 'quantum' then 'quantum'
    when 'business' then 'quantum'
    when 'apex' then 'quantum'
    when 'enterprise' then 'quantum'
    else null
  end;
$$;

create or replace function public.get_effective_organization_plan(p_org_id uuid)
returns table (
  plan_slug text,
  subscription_id uuid,
  status text,
  is_paid boolean,
  current_period_start timestamptz,
  current_period_end timestamptz,
  entitlement_overrides jsonb
)
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_sub record;
  v_norm_plan text;
  v_sched_plan text;
  v_granting boolean := false;
begin
  for v_sub in
    select
      s.id,
      s.plan,
      lower(trim(coalesce(s.status, 'free'))) as clean_status,
      s.current_period_start,
      s.current_period_end,
      s.billing_recovery_deadline,
      s.scheduled_plan,
      s.scheduled_change_effective_at,
      coalesce(s.entitlement_overrides, '{}'::jsonb) as overrides
    from public.subscriptions s
    where s.organization_id = p_org_id
    order by
      case when public.normalize_subscription_plan_slug(s.plan) in ('pulse', 'vector', 'quantum') then 0 else 1 end,
      s.updated_at desc
  loop
    v_norm_plan := public.normalize_subscription_plan_slug(v_sub.plan);
    if v_norm_plan is null then
      continue;
    end if;

    if v_norm_plan = 'zero' then
      if v_sub.clean_status in ('active', 'free') then
        return query select 'zero'::text, v_sub.id, v_sub.clean_status, false, v_sub.current_period_start, v_sub.current_period_end, v_sub.overrides;
        return;
      end if;
      continue;
    end if;

    -- Paid plan states that NEVER grant paid entitlements
    if v_sub.clean_status in ('pending', 'incomplete', 'payment_failed', 'expired', 'paused') then
      continue;
    end if;

    if v_sub.clean_status in ('active', 'trialing', 'cancellation_scheduled') then
      if v_sub.current_period_end is null or v_sub.current_period_end > now() then
        v_granting := true;
      end if;
    elsif v_sub.clean_status = 'past_due' then
      if v_sub.billing_recovery_deadline is null or v_sub.billing_recovery_deadline > now() then
        v_granting := true;
      end if;
    elsif v_sub.clean_status in ('canceled', 'cancelled') then
      if v_sub.current_period_end is not null and v_sub.current_period_end > now() then
        v_granting := true;
      end if;
    end if;

    if v_granting then
      -- Check if a scheduled downgrade effective timestamp has already arrived
      if v_sub.scheduled_plan is not null
         and v_sub.scheduled_change_effective_at is not null
         and v_sub.scheduled_change_effective_at <= now() then
        v_sched_plan := public.normalize_subscription_plan_slug(v_sub.scheduled_plan);
        if v_sched_plan is not null then
          v_norm_plan := v_sched_plan;
        end if;
      end if;

      return query select
        v_norm_plan,
        v_sub.id,
        v_sub.clean_status,
        (v_norm_plan in ('pulse', 'vector', 'quantum')),
        v_sub.current_period_start,
        v_sub.current_period_end,
        v_sub.overrides;
      return;
    end if;
  end loop;

  return query select 'zero'::text, null::uuid, 'free'::text, false, null::timestamptz, null::timestamptz, '{}'::jsonb;
end;
$$;

create or replace function public.organization_has_feature(
  p_org_id uuid,
  p_feature_key text
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_eff record;
  v_rank integer;
begin
  select * into v_eff from public.get_effective_organization_plan(p_org_id) limit 1;
  if v_eff.entitlement_overrides ? p_feature_key
     and jsonb_typeof(v_eff.entitlement_overrides -> p_feature_key) = 'boolean' then
    return (v_eff.entitlement_overrides ->> p_feature_key)::boolean;
  end if;

  v_rank := case coalesce(v_eff.plan_slug, 'zero')
    when 'quantum' then 3
    when 'vector' then 2
    when 'pulse' then 1
    else 0
  end;

  return case p_feature_key
    when 'assistant.basic' then true
    when 'assistant.website_qa' then true
    when 'knowledge.basic' then true
    when 'analytics.basic' then true
    when 'avatar.chat' then v_rank >= 1
    when 'avatar.custom_upload' then v_rank >= 1
    when 'avatar.studio' then v_rank >= 1
    when 'avatar.customization' then v_rank >= 1
    when 'visitor.enhanced_interactions' then v_rank >= 1
    when 'knowledge.advanced' then v_rank >= 1
    when 'knowledge.sync' then v_rank >= 1
    when 'analytics.advanced' then v_rank >= 1
    when 'knowledge.scheduled_sync' then v_rank >= 2
    when 'analytics.conversion' then v_rank >= 2
    when 'analytics.export' then v_rank >= 2
    when 'branding.whitelabel' then v_rank >= 2
    when 'analytics.multi_project' then v_rank >= 3
    when 'analytics.cohort' then v_rank >= 3
    when 'analytics.ai_summary' then v_rank >= 3
    when 'analytics.anomaly_detection' then v_rank >= 3
    when 'knowledge.versioning' then v_rank >= 3
    when 'advanced_permissions' then v_rank >= 3
    when 'branding.full_whitelabel' then v_rank >= 3
    when 'projects.advanced_management' then v_rank >= 3
    else false
  end;
end;
$$;

-- ============================================================================
-- 5. ATOMIC WORKSPACE, PROJECT & SEAT QUOTA TRIGGERS (Phases 09, 15, 21, 22, 23, 32)
-- ============================================================================

-- 5.1 Workspace Creation Quota Enforcement (Zero: 1, Pulse: 1, Vector: 2, Quantum: 10)
create or replace function public.enforce_workspace_creation_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing_count integer;
  v_max_workspaces integer := 1;
  v_org record;
  v_eff record;
  v_candidate integer;
begin
  perform 1 from public.profiles where id = new.owner_id for update;

  select count(*) into v_existing_count
  from public.organizations o
  where o.owner_id = new.owner_id;

  -- First workspace for any user is always permitted
  if v_existing_count = 0 then
    new.is_personal := true;
    return new;
  end if;

  -- Determine highest workspace allowance across user's owned organizations
  for v_org in
    select id from public.organizations where owner_id = new.owner_id
  loop
    select * into v_eff from public.get_effective_organization_plan(v_org.id) limit 1;
    if v_eff.entitlement_overrides ->> 'workspaces.max_count' = 'unlimited' then
      return new;
    elsif (v_eff.entitlement_overrides ->> 'workspaces.max_count') ~ '^[0-9]+$' then
      v_candidate := (v_eff.entitlement_overrides ->> 'workspaces.max_count')::integer;
    else
      v_candidate := case v_eff.plan_slug
        when 'quantum' then 10
        when 'vector' then 2
        when 'pulse' then 1
        else 1
      end;
    end if;

    if v_candidate > v_max_workspaces then
      v_max_workspaces := v_candidate;
    end if;
  end loop;

  if v_existing_count >= v_max_workspaces then
    raise exception using
      errcode = '23505',
      constraint = 'organizations_workspace_limit',
      message = 'WORKSPACE_LIMIT_REACHED',
      detail = jsonb_build_object(
        'resource', 'workspaces.max_count',
        'limit', v_max_workspaces,
        'current', v_existing_count,
        'requested', 1
      )::text;
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_enforce_workspace_limit on public.organizations;
create trigger organizations_enforce_workspace_limit
  before insert on public.organizations
  for each row execute function public.enforce_workspace_creation_limit();

-- 5.2 Project Quota Enforcement (Zero: 1, Pulse: 3, Vector: 10, Quantum: Unlimited/NULL)
create or replace function public.assign_project_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_eff record;
  v_max_projects integer;
  v_is_unlimited boolean := false;
  v_current_projects integer;
begin
  if new.organization_id is null then
    select o.id into v_org_id
    from public.organizations o
    where o.owner_id = new.owner_id
    order by o.is_personal desc, o.created_at asc
    limit 1;
    new.organization_id := v_org_id;
  end if;

  if new.organization_id is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.owner_id
  ) then
    raise exception using errcode = '23514', message = 'PROJECT_ORGANIZATION_MISMATCH';
  end if;

  -- Only enforce creation quota on INSERT or moving to a different organization
  if tg_op = 'INSERT' or (new.organization_id is distinct from old.organization_id and coalesce(new.status, 'active') <> 'deleted') then
    perform 1 from public.organizations where id = new.organization_id for update;

    select * into v_eff from public.get_effective_organization_plan(new.organization_id) limit 1;

    if v_eff.entitlement_overrides ->> 'projects.max_count' = 'unlimited' then
      v_is_unlimited := true;
      v_max_projects := null;
    elsif (v_eff.entitlement_overrides ->> 'projects.max_count') ~ '^[0-9]+$' then
      v_max_projects := (v_eff.entitlement_overrides ->> 'projects.max_count')::integer;
    elsif v_eff.plan_slug = 'quantum' then
      v_is_unlimited := true;
      v_max_projects := null;
    elsif v_eff.plan_slug = 'vector' then
      v_max_projects := 10;
    elsif v_eff.plan_slug = 'pulse' then
      v_max_projects := 3;
    else
      v_max_projects := 1;
    end if;

    if not v_is_unlimited and v_max_projects is not null then
      select count(*) into v_current_projects
      from public.projects p
      where p.organization_id = new.organization_id
        and p.id <> new.id
        and coalesce(p.status, 'active') <> 'deleted';

      if v_current_projects >= v_max_projects then
        raise exception using
          errcode = '23505',
          constraint = 'projects_organization_limit',
          message = 'PROJECT_LIMIT_REACHED',
          detail = jsonb_build_object(
            'resource', 'projects.max_count',
            'plan', v_eff.plan_slug,
            'limit', v_max_projects,
            'current', v_current_projects,
            'requested', 1
          )::text;
      end if;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists projects_assign_organization on public.projects;
create trigger projects_assign_organization
  before insert or update on public.projects
  for each row execute function public.assign_project_organization();

-- 5.3 Organization Seat Limit Enforcement (Zero: 1, Pulse: 1, Vector: 3, Quantum: 10)
create or replace function public.enforce_organization_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_eff record;
  v_max_members integer;
  v_current_members integer;
begin
  perform 1 from public.organizations where id = new.organization_id for update;

  select * into v_eff from public.get_effective_organization_plan(new.organization_id) limit 1;

  if v_eff.entitlement_overrides ->> 'organization.max_members' = 'unlimited' then
    return new;
  elsif (v_eff.entitlement_overrides ->> 'organization.max_members') ~ '^[0-9]+$' then
    v_max_members := (v_eff.entitlement_overrides ->> 'organization.max_members')::integer;
  else
    v_max_members := case v_eff.plan_slug
      when 'quantum' then 10
      when 'vector' then 3
      when 'pulse' then 1
      else 1
    end;
  end if;

  select count(*) into v_current_members
  from public.organization_members m
  where m.organization_id = new.organization_id
    and m.id <> new.id;

  if v_current_members >= v_max_members then
    raise exception using
      errcode = '23505',
      constraint = 'organization_member_limit',
      message = 'ORGANIZATION_SEAT_LIMIT_REACHED',
      detail = jsonb_build_object(
        'resource', 'organization.max_members',
        'plan', v_eff.plan_slug,
        'limit', v_max_members,
        'current', v_current_members
      )::text;
  end if;

  return new;
end;
$$;

drop trigger if exists organization_members_enforce_seat_limit on public.organization_members;
create trigger organization_members_enforce_seat_limit
  before insert or update of organization_id on public.organization_members
  for each row execute function public.enforce_organization_seat_limit();

-- ============================================================================
-- 6. GRANULAR RBAC & PROJECT AUTHORIZATION (Phases 21 & 29)
-- ============================================================================

create or replace function public.user_has_project_access(proj_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = proj_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1
          from public.organizations o
          where o.id = p.organization_id
            and o.owner_id = auth.uid()
        )
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
        )
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = p.organization_id
            and om.user_id = auth.uid()
            and (
              om.role = 'owner'
              or coalesce((om.permissions ->> 'all_projects_access')::boolean, false) = true
            )
        )
      )
  );
$$;

create or replace function public.user_can_manage_project(proj_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.projects p
    where p.id = proj_id
      and (
        p.owner_id = auth.uid()
        or exists (
          select 1
          from public.organizations o
          where o.id = p.organization_id
            and o.owner_id = auth.uid()
        )
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
            and pm.role in ('owner', 'admin', 'editor')
        )
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = p.organization_id
            and om.user_id = auth.uid()
            and (
              om.role = 'owner'
              or (
                om.role in ('admin', 'editor')
                and coalesce((om.permissions ->> 'all_projects_access')::boolean, false) = true
              )
            )
        )
      )
  );
$$;

create or replace function public.user_has_project_permission(
  proj_id uuid,
  perm_key text
)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_project record;
  v_pm record;
  v_om record;
begin
  select id, owner_id, organization_id into v_project
  from public.projects
  where id = proj_id;

  if v_project.id is null then
    return false;
  end if;

  if v_project.owner_id = auth.uid() then
    return true;
  end if;

  if exists (
    select 1 from public.organizations o
    where o.id = v_project.organization_id and o.owner_id = auth.uid()
  ) then
    return true;
  end if;

  select role, permissions, can_manage_billing into v_om
  from public.organization_members
  where organization_id = v_project.organization_id
    and user_id = auth.uid()
  limit 1;

  if v_om.role = 'owner' then
    return true;
  end if;

  if perm_key = 'billing.manage' then
    return coalesce(v_om.can_manage_billing, false);
  end if;

  select role, permissions into v_pm
  from public.project_members
  where project_id = proj_id
    and user_id = auth.uid()
  limit 1;

  -- Explicit JSON permission override on project_members
  if v_pm.permissions is not null and v_pm.permissions ? perm_key
     and jsonb_typeof(v_pm.permissions -> perm_key) = 'boolean' then
    return (v_pm.permissions ->> perm_key)::boolean;
  end if;

  -- Role-based default permissions for explicit project_members
  if v_pm.role is not null then
    if v_pm.role = 'owner' or v_pm.role = 'admin' then
      return perm_key <> 'billing.manage';
    elsif v_pm.role = 'editor' then
      return perm_key in ('analytics.view', 'ai_settings.modify', 'knowledge.manage', 'avatar.publish');
    elsif v_pm.role in ('viewer', 'member') then
      return perm_key in ('analytics.view');
    end if;
  end if;

  -- Check organization-wide explicit grant if configured
  if v_om.role is not null and coalesce((v_om.permissions ->> 'all_projects_access')::boolean, false) = true then
    if v_om.permissions ? perm_key and jsonb_typeof(v_om.permissions -> perm_key) = 'boolean' then
      return (v_om.permissions ->> perm_key)::boolean;
    end if;
    if v_om.role = 'admin' then
      return perm_key <> 'billing.manage';
    elsif v_om.role = 'editor' then
      return perm_key in ('analytics.view', 'ai_settings.modify', 'knowledge.manage', 'avatar.publish');
    elsif v_om.role in ('viewer', 'member') then
      return perm_key in ('analytics.view');
    end if;
  end if;

  return false;
end;
$$;

grant execute on function public.user_has_project_access(uuid) to authenticated, service_role;
grant execute on function public.user_can_manage_project(uuid) to authenticated, service_role;
grant execute on function public.user_has_project_permission(uuid, text) to authenticated, service_role;

-- ============================================================================
-- 7. REPAIR KNOWLEDGE QUOTA UNITS & ATOMIC CRAWL PAGE QUOTA (Phases 04, 05, 10, 11, 32)
-- ============================================================================

-- Drop broken 4-parameter overload introduced in 20261120120000
drop function if exists public.reserve_knowledge_quota_unit(uuid, text, text, jsonb);

create or replace function public.reserve_knowledge_quota_unit(
  p_project_id uuid,
  p_item_key text,
  p_item_type text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_eff record;
  v_max_units bigint;
  v_max_files bigint;
  v_max_entries bigint;
  v_used_units bigint;
  v_used_files bigint;
  v_used_entries bigint;
  v_current_status text;
begin
  if p_item_key is null or length(p_item_key) = 0 or length(p_item_key) > 1024 then
    raise exception using errcode = '22023', message = 'invalid knowledge quota item key';
  end if;

  select project.organization_id
    into v_org_id
    from public.projects project
   where project.id = p_project_id
     and coalesce(project.status, 'active') <> 'deleted'
   for update;

  if v_org_id is null then
    raise exception using errcode = '23503', message = 'KNOWLEDGE_PROJECT_NOT_FOUND';
  end if;

  perform 1 from public.organizations where id = v_org_id for update;

  select unit.status
    into v_current_status
    from public.knowledge_quota_units unit
   where unit.project_id = p_project_id
     and unit.item_key = p_item_key
   for update;

  if found then
    return jsonb_build_object(
      'ok', true,
      'duplicate', true,
      'status', v_current_status
    );
  end if;

  select * into v_eff from public.get_effective_organization_plan(v_org_id) limit 1;

  -- Resolve canonical knowledge limits (NULL = unlimited)
  v_max_units := case
    when v_eff.entitlement_overrides ->> 'knowledge.max_units' = 'unlimited' then null
    when (v_eff.entitlement_overrides ->> 'knowledge.max_units') ~ '^[0-9]+$' then (v_eff.entitlement_overrides ->> 'knowledge.max_units')::bigint
    when v_eff.plan_slug = 'quantum' then null
    when v_eff.plan_slug = 'vector' then 2000
    when v_eff.plan_slug = 'pulse' then 250
    else 50
  end;

  v_max_files := case
    when v_eff.entitlement_overrides ->> 'knowledge.max_files' = 'unlimited' then null
    when (v_eff.entitlement_overrides ->> 'knowledge.max_files') ~ '^[0-9]+$' then (v_eff.entitlement_overrides ->> 'knowledge.max_files')::bigint
    when v_eff.plan_slug = 'quantum' then null
    when v_eff.plan_slug = 'vector' then 50
    when v_eff.plan_slug = 'pulse' then 5
    else 3
  end;

  v_max_entries := case
    when v_eff.entitlement_overrides ->> 'knowledge.max_entries' = 'unlimited' then null
    when (v_eff.entitlement_overrides ->> 'knowledge.max_entries') ~ '^[0-9]+$' then (v_eff.entitlement_overrides ->> 'knowledge.max_entries')::bigint
    when v_eff.plan_slug = 'quantum' then null
    when v_eff.plan_slug = 'vector' then 2000
    when v_eff.plan_slug = 'pulse' then 250
    else 50
  end;

  -- Check uploaded document file count across organization projects when reserving uploaded_file / file
  if p_item_type in ('uploaded_file', 'file') and p_item_key like 'file:%' and v_max_files is not null then
    select count(*)
      into v_used_files
      from public.knowledge_quota_units unit
      join public.projects p on p.id = unit.project_id
     where p.organization_id = v_org_id
       and coalesce(p.status, 'active') <> 'deleted'
       and unit.item_key like 'file:%';

    if v_used_files >= v_max_files then
      raise exception using
        errcode = 'P0001',
        message = 'KNOWLEDGE_QUOTA_REACHED',
        detail = jsonb_build_object(
          'resource', 'knowledge.max_files',
          'plan', v_eff.plan_slug,
          'limit', v_max_files,
          'current', v_used_files,
          'requested', 1,
          'project_id', p_project_id
        )::text;
    end if;
  end if;

  if p_item_type = 'manual_entry' and v_max_entries is not null then
    select count(*)
      into v_used_entries
      from public.knowledge_quota_units unit
     where unit.project_id = p_project_id
       and unit.item_type = 'manual_entry';

    if v_used_entries >= v_max_entries then
      raise exception using
        errcode = 'P0001',
        message = 'KNOWLEDGE_QUOTA_REACHED',
        detail = jsonb_build_object(
          'resource', 'knowledge.max_entries',
          'plan', v_eff.plan_slug,
          'limit', v_max_entries,
          'current', v_used_entries,
          'requested', 1,
          'project_id', p_project_id
        )::text;
    end if;
  end if;

  select count(*)
    into v_used_units
    from public.knowledge_quota_units unit
   where unit.project_id = p_project_id;

  if v_max_units is not null and v_used_units >= v_max_units then
    raise exception using
      errcode = 'P0001',
      message = 'KNOWLEDGE_QUOTA_REACHED',
      detail = jsonb_build_object(
        'resource', 'knowledge.max_units',
        'plan', v_eff.plan_slug,
        'limit', v_max_units,
        'current', v_used_units,
        'requested', 1,
        'project_id', p_project_id
      )::text;
  end if;

  insert into public.knowledge_quota_units(project_id, item_key, item_type, status)
  values (p_project_id, p_item_key, p_item_type, 'reserved');

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'status', 'reserved',
    'plan', v_eff.plan_slug
  );
end;
$$;

revoke all on function public.reserve_knowledge_quota_unit(uuid, text, text) from public, anon, authenticated;
grant execute on function public.reserve_knowledge_quota_unit(uuid, text, text) to service_role;

-- Update enforce_knowledge_file_quota to classify uploaded_file vs crawled_page vs sitemap_page & enforce storage quota
create or replace function public.enforce_knowledge_file_quota()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source_project_id uuid;
  v_org_id uuid;
  v_eff record;
  v_max_storage bigint;
  v_current_storage bigint;
  v_old_key text;
  v_new_key text;
  v_item_type text;
begin
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id
      or new.source_id is distinct from old.source_id
      or new.site_url_id is distinct from old.site_url_id then
      raise exception using errcode = '23514', message = 'KNOWLEDGE_ITEM_IDENTITY_IMMUTABLE';
    end if;
  end if;

  select source.project_id into v_source_project_id
    from public.knowledge_sources source
   where source.id = new.source_id;
  if v_source_project_id is null or v_source_project_id is distinct from new.project_id then
    raise exception using errcode = '23514', message = 'KNOWLEDGE_SOURCE_PROJECT_MISMATCH';
  end if;

  -- Storage quota check across project's organization
  if coalesce(new.status, 'processing') <> 'failed' and coalesce(new.file_size, 0) > 0 then
    select organization_id into v_org_id from public.projects where id = new.project_id;
    if v_org_id is not null then
      select * into v_eff from public.get_effective_organization_plan(v_org_id) limit 1;
      v_max_storage := case
        when v_eff.entitlement_overrides ->> 'knowledge.max_storage_bytes' = 'unlimited' then null
        when (v_eff.entitlement_overrides ->> 'knowledge.max_storage_bytes') ~ '^[0-9]+$' then (v_eff.entitlement_overrides ->> 'knowledge.max_storage_bytes')::bigint
        when v_eff.plan_slug = 'quantum' then 10737418240 -- 10 GB fair-use
        when v_eff.plan_slug = 'vector' then 1073741824  -- 1 GB
        when v_eff.plan_slug = 'pulse' then 104857600    -- 100 MB
        else 10485760                                    -- 10 MB Zero
      end;

      if v_max_storage is not null then
        select coalesce(sum(coalesce(f.file_size, 0)), 0)
          into v_current_storage
          from public.knowledge_files f
          join public.projects p on p.id = f.project_id
         where p.organization_id = v_org_id
           and coalesce(p.status, 'active') <> 'deleted'
           and coalesce(f.status, 'processing') <> 'failed'
           and f.id <> new.id;

        if v_current_storage + coalesce(new.file_size, 0) > v_max_storage then
          raise exception using
            errcode = 'P0001',
            message = 'KNOWLEDGE_STORAGE_QUOTA_REACHED',
            detail = jsonb_build_object(
              'resource', 'knowledge.max_storage_bytes',
              'plan', v_eff.plan_slug,
              'limit', v_max_storage,
              'current', v_current_storage,
              'requested', coalesce(new.file_size, 0)
            )::text;
        end if;
      end if;
    end if;
  end if;

  v_new_key := public.knowledge_quota_file_key(
    new.source_id, new.file_name, new.content_url, new.site_url_id
  );
  v_item_type := case
    when new.site_url_id is not null then 'sitemap_page'
    when nullif(trim(coalesce(new.content_url, '')), '') is not null then 'crawled_page'
    else 'uploaded_file'
  end;

  if tg_op = 'UPDATE' then
    v_old_key := public.knowledge_quota_file_key(
      old.source_id, old.file_name, old.content_url, old.site_url_id
    );
    if v_new_key is distinct from v_old_key then
      perform 1 from public.projects where id = new.project_id for update;
      if not exists (
        select 1
          from public.knowledge_files file
         where file.project_id = old.project_id
           and file.id <> old.id
           and file.status <> 'failed'
           and public.knowledge_quota_file_key(
             file.source_id, file.file_name, file.content_url, file.site_url_id
           ) = v_old_key
      ) then
        delete from public.knowledge_quota_units
         where project_id = old.project_id and item_key = v_old_key;
      end if;
    end if;
  end if;

  if coalesce(new.status, 'processing') <> 'failed' then
    perform public.reserve_knowledge_quota_unit(new.project_id, v_new_key, v_item_type);
  end if;

  return new;
end;
$$;

drop trigger if exists knowledge_files_quota_reserve on public.knowledge_files;
create trigger knowledge_files_quota_reserve
  before insert or update on public.knowledge_files
  for each row execute function public.enforce_knowledge_file_quota();

drop trigger if exists knowledge_files_quota_state on public.knowledge_files;
create trigger knowledge_files_quota_state
  after insert or update on public.knowledge_files
  for each row execute function public.update_knowledge_file_quota();

drop trigger if exists knowledge_files_quota_release on public.knowledge_files;
create trigger knowledge_files_quota_release
  after delete on public.knowledge_files
  for each row execute function public.release_knowledge_file_quota();

drop trigger if exists knowledge_entries_quota_reserve on public.knowledge_entries;
create trigger knowledge_entries_quota_reserve
  before insert or update on public.knowledge_entries
  for each row execute function public.enforce_knowledge_entry_quota();

drop trigger if exists knowledge_entries_quota_state on public.knowledge_entries;
create trigger knowledge_entries_quota_state
  after insert on public.knowledge_entries
  for each row execute function public.update_knowledge_entry_quota();

drop trigger if exists knowledge_entries_quota_sync on public.knowledge_entries;
create trigger knowledge_entries_quota_sync
  after update of related_pages on public.knowledge_entries
  for each row execute function public.sync_knowledge_entry_quota();

drop trigger if exists knowledge_entries_quota_release on public.knowledge_entries;
create trigger knowledge_entries_quota_release
  after delete on public.knowledge_entries
  for each row execute function public.release_knowledge_entry_quota();

-- 7.2 Atomic Website Crawl Page Quota RPCs (Zero: 10, Pulse: 100, Vector: 1000, Quantum: Fair-use 10,000 / Unlimited)
create or replace function public.reserve_crawl_page_quota(
  p_project_id uuid,
  p_page_url text,
  p_attempt_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_eff record;
  v_period_key text;
  v_limit bigint;
  v_is_unlimited boolean := false;
  v_used bigint;
  v_clean_url text;
  v_key text;
  v_existing record;
  v_res_id uuid;
begin
  v_clean_url := trim(coalesce(p_page_url, ''));
  if v_clean_url = '' then
    raise exception using errcode = '22023', message = 'INVALID_CRAWL_PAGE_URL';
  end if;

  select organization_id into v_org_id
  from public.projects
  where id = p_project_id
    and coalesce(status, 'active') <> 'deleted';

  if v_org_id is null then
    raise exception using errcode = '23503', message = 'PROJECT_NOT_FOUND';
  end if;

  -- Lock organization row so concurrent crawls / multiple sitemaps cannot bypass quota
  perform 1 from public.organizations where id = v_org_id for update;

  -- Release abandoned reservations older than 30 minutes
  update public.crawl_page_quota_reservations
     set status = 'released',
         released_at = now()
   where organization_id = v_org_id
     and status = 'reserved'
     and created_at < now() - interval '30 minutes';

  select * into v_eff from public.get_effective_organization_plan(v_org_id) limit 1;

  v_period_key := case
    when v_eff.current_period_start is not null then to_char(v_eff.current_period_start at time zone 'utc', 'YYYY-MM-DD')
    else to_char(now() at time zone 'utc', 'YYYY-MM')
  end;

  if v_eff.entitlement_overrides ->> 'crawl.max_pages' = 'unlimited' then
    v_is_unlimited := true;
    v_limit := 10000; -- Documented fair-use safeguard
  elsif (v_eff.entitlement_overrides ->> 'crawl.max_pages') ~ '^[0-9]+$' then
    v_limit := (v_eff.entitlement_overrides ->> 'crawl.max_pages')::bigint;
  elsif v_eff.plan_slug = 'quantum' then
    v_is_unlimited := true;
    v_limit := 10000; -- Documented fair-use safeguard per billing period
  elsif v_eff.plan_slug = 'vector' then
    v_limit := 1000;
  elsif v_eff.plan_slug = 'pulse' then
    v_limit := 100;
  else
    v_limit := 10;
  end if;

  v_key := coalesce(nullif(trim(p_attempt_key), ''), gen_random_uuid()::text);

  select id, status into v_existing
  from public.crawl_page_quota_reservations
  where organization_id = v_org_id
    and period_key = v_period_key
    and attempt_key = v_key
  limit 1;

  if v_existing.id is not null and v_existing.status in ('reserved', 'processed') then
    return jsonb_build_object(
      'allowed', true,
      'duplicate', true,
      'reservationId', v_existing.id,
      'plan', v_eff.plan_slug,
      'periodKey', v_period_key,
      'limit', case when v_is_unlimited then null else v_limit end,
      'unlimited', v_is_unlimited
    );
  end if;

  select count(*) into v_used
  from public.crawl_page_quota_reservations
  where organization_id = v_org_id
    and period_key = v_period_key
    and status in ('reserved', 'processed');

  if v_limit is not null and v_used >= v_limit then
    return jsonb_build_object(
      'allowed', false,
      'code', 'CRAWL_PAGE_QUOTA_EXCEEDED',
      'plan', v_eff.plan_slug,
      'periodKey', v_period_key,
      'used', v_used,
      'limit', v_limit,
      'unlimited', v_is_unlimited
    );
  end if;

  if v_existing.id is not null then
    update public.crawl_page_quota_reservations
       set status = 'reserved',
           released_at = null,
           created_at = now()
     where id = v_existing.id
     returning id into v_res_id;
  else
    insert into public.crawl_page_quota_reservations (
      organization_id, project_id, period_key, page_url, attempt_key, status
    )
    values (
      v_org_id, p_project_id, v_period_key, v_clean_url, v_key, 'reserved'
    )
    returning id into v_res_id;
  end if;

  return jsonb_build_object(
    'allowed', true,
    'duplicate', false,
    'reservationId', v_res_id,
    'plan', v_eff.plan_slug,
    'periodKey', v_period_key,
    'used', v_used + 1,
    'limit', case when v_is_unlimited then null else v_limit end,
    'fairUseLimit', v_limit,
    'unlimited', v_is_unlimited
  );
end;
$$;

create or replace function public.confirm_crawl_page_quota(p_reservation_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.crawl_page_quota_reservations
     set status = 'processed',
         processed_at = coalesce(processed_at, now())
   where id = p_reservation_id;
$$;

create or replace function public.release_crawl_page_quota(p_reservation_id uuid)
returns void
language sql
security definer
set search_path = pg_catalog, public
as $$
  update public.crawl_page_quota_reservations
     set status = 'released',
         released_at = now()
   where id = p_reservation_id
     and status = 'reserved';
$$;

create or replace function public.get_crawl_quota_usage(p_project_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_eff record;
  v_period_key text;
  v_limit bigint;
  v_is_unlimited boolean := false;
  v_processed bigint := 0;
  v_reserved bigint := 0;
begin
  select organization_id into v_org_id
  from public.projects
  where id = p_project_id;

  if v_org_id is null then
    return jsonb_build_object('error', 'PROJECT_NOT_FOUND');
  end if;

  select * into v_eff from public.get_effective_organization_plan(v_org_id) limit 1;

  v_period_key := case
    when v_eff.current_period_start is not null then to_char(v_eff.current_period_start at time zone 'utc', 'YYYY-MM-DD')
    else to_char(now() at time zone 'utc', 'YYYY-MM')
  end;

  if v_eff.entitlement_overrides ->> 'crawl.max_pages' = 'unlimited' then
    v_is_unlimited := true;
    v_limit := 10000;
  elsif (v_eff.entitlement_overrides ->> 'crawl.max_pages') ~ '^[0-9]+$' then
    v_limit := (v_eff.entitlement_overrides ->> 'crawl.max_pages')::bigint;
  elsif v_eff.plan_slug = 'quantum' then
    v_is_unlimited := true;
    v_limit := 10000;
  elsif v_eff.plan_slug = 'vector' then
    v_limit := 1000;
  elsif v_eff.plan_slug = 'pulse' then
    v_limit := 100;
  else
    v_limit := 10;
  end if;

  select
    count(*) filter (where status = 'processed'),
    count(*) filter (where status = 'reserved' and created_at >= now() - interval '30 minutes')
  into v_processed, v_reserved
  from public.crawl_page_quota_reservations
  where organization_id = v_org_id
    and period_key = v_period_key;

  return jsonb_build_object(
    'plan', v_eff.plan_slug,
    'periodKey', v_period_key,
    'processed', v_processed,
    'reserved', v_reserved,
    'used', v_processed + v_reserved,
    'limit', case when v_is_unlimited then null else v_limit end,
    'fairUseLimit', v_limit,
    'remaining', case when v_is_unlimited then null else greatest(0, v_limit - v_processed - v_reserved) end,
    'unlimited', v_is_unlimited
  );
end;
$$;

revoke all on function public.reserve_crawl_page_quota(uuid, text, text) from public, anon, authenticated;
revoke all on function public.confirm_crawl_page_quota(uuid) from public, anon, authenticated;
revoke all on function public.release_crawl_page_quota(uuid) from public, anon, authenticated;
revoke all on function public.get_crawl_quota_usage(uuid) from public, anon, authenticated;
grant execute on function public.reserve_crawl_page_quota(uuid, text, text) to service_role;
grant execute on function public.confirm_crawl_page_quota(uuid) to service_role;
grant execute on function public.release_crawl_page_quota(uuid) to service_role;
grant execute on function public.get_crawl_quota_usage(uuid) to service_role;

-- ============================================================================
-- 8. SCHEDULED SYNCHRONIZATION ATOMIC CLAIM RPC (Phase 17)
-- ============================================================================

create or replace function public.claim_due_scheduled_knowledge_syncs(
  p_worker_id text default 'scheduler',
  p_limit integer default 10
)
returns table (
  schedule_id uuid,
  organization_id uuid,
  project_id uuid,
  source_id uuid,
  source_type text,
  source_name text,
  content_url text,
  frequency text,
  idempotency_token text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_sched record;
  v_next timestamptz;
  v_bucket text;
  v_idem text;
  v_sitemap record;
begin
  for v_sched in
    select
      s.id as sched_id,
      s.organization_id as org_id,
      s.project_id as proj_id,
      s.source_id as src_id,
      s.frequency as freq,
      ks.source_type as src_type,
      ks.name as src_name,
      coalesce(ks.metadata ->> 'content_url', ks.name) as target_url
    from public.knowledge_sync_schedules s
    join public.knowledge_sources ks on ks.id = s.source_id
    join public.projects p on p.id = s.project_id
    where s.enabled = true
      and s.next_run_at <= now()
      and coalesce(p.status, 'active') = 'active'
    order by s.next_run_at asc
    limit greatest(1, least(coalesce(p_limit, 10), 50))
    for update of s skip locked
  loop
    -- Verify subscription still includes scheduled synchronization (Vector / Quantum)
    if not public.organization_has_feature(v_sched.org_id, 'knowledge.scheduled_sync') then
      update public.knowledge_sync_schedules
         set enabled = false,
             last_status = 'paused_entitlement',
             last_error = 'Paused automatically because active subscription does not include scheduled synchronization.',
             updated_at = now()
       where id = v_sched.sched_id;

      update public.knowledge_sources
         set sync_schedule_enabled = false,
             updated_at = now()
       where id = v_sched.src_id;
      continue;
    end if;

    v_next := now() + case v_sched.freq
      when 'hourly' then interval '1 hour'
      when 'every_6h' then interval '6 hours'
      when 'weekly' then interval '7 days'
      else interval '1 day'
    end;

    v_bucket := to_char(now() at time zone 'utc', 'YYYYMMDDHH24');
    v_idem := 'sched_sync:' || v_sched.sched_id::text || ':' || v_bucket;

    -- For sitemap sources, atomically enqueue sitemap_crawl_jobs if no active job is running
    if v_sched.src_type = 'sitemap' then
      select sm.id, sm.connection_id into v_sitemap
      from public.site_sitemaps sm
      where sm.project_id = v_sched.proj_id
        and sm.knowledge_source_id = v_sched.src_id
        and sm.removed_at is null
      limit 1;

      if v_sitemap.id is not null and not exists (
        select 1 from public.sitemap_crawl_jobs j
        where j.sitemap_id = v_sitemap.id
          and j.state in ('queued', 'processing', 'retrying')
      ) then
        insert into public.sitemap_crawl_jobs (
          project_id, connection_id, sitemap_id, job_type, state, idempotency_key
        )
        values (
          v_sched.proj_id, v_sitemap.connection_id, v_sitemap.id, 'sitemap', 'queued', v_idem
        )
        on conflict do nothing;
      end if;
    end if;

    update public.knowledge_sync_schedules
       set last_run_at = now(),
           next_run_at = v_next,
           last_status = case when v_sched.src_type = 'sitemap' then 'queued' else 'running' end,
           claimed_at = now(),
           claimed_by = p_worker_id,
           idempotency_token = v_idem,
           updated_at = now()
     where id = v_sched.sched_id;

    update public.knowledge_sources
       set last_scheduled_sync_at = now(),
           next_sync_at = v_next,
           updated_at = now()
     where id = v_sched.src_id;

    return query select
      v_sched.sched_id,
      v_sched.org_id,
      v_sched.proj_id,
      v_sched.src_id,
      v_sched.src_type,
      v_sched.src_name,
      v_sched.target_url,
      v_sched.freq,
      v_idem;
  end loop;
end;
$$;

revoke all on function public.claim_due_scheduled_knowledge_syncs(text, integer) from public, anon, authenticated;
grant execute on function public.claim_due_scheduled_knowledge_syncs(text, integer) to service_role;

-- ============================================================================
-- 9. STORAGE ENTITLEMENT HARDENING FOR CUSTOM AVATARS (Phase 07)
-- ============================================================================

create or replace function public.user_can_upload_avatar_storage(object_name text)
returns boolean
language plpgsql
security definer
stable
set search_path = pg_catalog, public
as $$
declare
  first_folder text;
  second_folder text;
  proj_id uuid;
  org_id uuid;
begin
  first_folder := (storage.foldername(object_name))[1];
  second_folder := (storage.foldername(object_name))[2];

  if second_folder is not null then
    begin
      proj_id := second_folder::uuid;
    exception when others then
      proj_id := null;
    end;
  end if;

  if proj_id is null and first_folder is not null then
    begin
      proj_id := first_folder::uuid;
    exception when others then
      proj_id := null;
    end;
  end if;

  if proj_id is null or not public.user_can_manage_project(proj_id) then
    return false;
  end if;

  select p.organization_id into org_id
  from public.projects p
  where p.id = proj_id;

  if org_id is null then
    return false;
  end if;

  return public.organization_has_feature(org_id, 'avatar.custom_upload');
end;
$$;

drop policy if exists "avatars_storage_insert" on storage.objects;
create policy "avatars_storage_insert" on storage.objects
  for insert with check (
    bucket_id = 'avatars' and
    public.user_can_upload_avatar_storage(name)
  );

drop policy if exists "avatars_storage_update" on storage.objects;
create policy "avatars_storage_update" on storage.objects
  for update using (
    bucket_id = 'avatars' and
    public.user_can_upload_avatar_storage(name)
  );

-- ============================================================================
-- 10. RLS POLICIES FOR NEW TABLES
-- ============================================================================

drop policy if exists knowledge_sync_schedules_project_access on public.knowledge_sync_schedules;
create policy knowledge_sync_schedules_project_access on public.knowledge_sync_schedules
  for select using (public.user_has_project_access(project_id));

drop policy if exists workspace_invitations_org_read on public.workspace_invitations;
create policy workspace_invitations_org_read on public.workspace_invitations
  for select using (public.user_is_organization_member(organization_id));

drop policy if exists project_templates_org_read on public.project_templates;
create policy project_templates_org_read on public.project_templates
  for select using (public.user_is_organization_member(organization_id));

drop policy if exists analytics_anomalies_project_read on public.analytics_anomalies;
create policy analytics_anomalies_project_read on public.analytics_anomalies
  for select using (public.user_has_project_access(project_id));

drop policy if exists analytics_ai_summaries_project_read on public.analytics_ai_summaries;
create policy analytics_ai_summaries_project_read on public.analytics_ai_summaries
  for select using (public.user_has_project_access(project_id));

drop policy if exists knowledge_item_versions_project_read on public.knowledge_item_versions;
create policy knowledge_item_versions_project_read on public.knowledge_item_versions
  for select using (public.user_has_project_access(project_id));

drop policy if exists configuration_versions_project_read on public.configuration_versions;
create policy configuration_versions_project_read on public.configuration_versions
  for select using (public.user_has_project_access(project_id));
