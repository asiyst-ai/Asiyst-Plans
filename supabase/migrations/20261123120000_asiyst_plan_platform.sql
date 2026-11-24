-- ============================================================================
-- Migration: 20261123120000_asiyst_plan_platform.sql
-- Project: Asiyst Plan (plan.asiyst.com) & Asiyst-WEB Integration
-- Description:
--   1. Creates dynamic product catalog, plans, prices, features, and plan-features
--      tables (`billing_products`, `billing_plans`, `billing_prices`,
--      `billing_features`, `billing_plan_features`).
--   2. Seeds the 4 official commercial plans:
--      - Asiyst Zero (`zero` / legacy `free`) — $0/month (0 minor units)
--      - Asiyst Pulse (`pulse` / legacy `starter`) — $24/month (2400 minor units)
--      - Asiyst Vector (`vector` / legacy `pro`) — $54/month (5400 minor units)
--      - Asiyst Quantum (`quantum` / legacy `business`) — $154/month (15400 minor units)
--   3. Extends `public.subscriptions` to accept both `zero` and `free` (plus
--      `pulse`, `vector`, `quantum`, and legacy keys), adds `product_id`,
--      `plan_id`, `billing_interval`, `cancelled_at`, `scheduled_plan`, and
--      `first_paid_welcome_sent_at`.
--   4. Creates `billing_orders`, `billing_payments`, `billing_invoices`,
--      `billing_webhook_events`, `organization_billing_contacts`,
--      `billing_admin_invitations`, `notification_outbox`,
--      `notification_preferences`, and `email_delivery_events`.
--   5. Restores and upgrades atomic database enforcement triggers and RPCs so
--      that plan benefits ONLY activate after verified payment/subscription
--      state (`active`, `trialing`, `past_due`, or `canceled` with future
--      `current_period_end`) and strictly separate AI Credits from subscriptions.
-- ============================================================================

-- ============================================================================
-- 1. PRODUCT CATALOG (`billing_products`)
-- ============================================================================
create table if not exists public.billing_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text not null default '',
  logo_url text,
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.billing_products (slug, name, description, status)
values (
  'asiyst-ai',
  'Asiyst AI',
  'Interactive 3D AI Website Assistant, Knowledge Engine, Avatar Studio & Website Intelligence Platform.',
  'active'
)
on conflict (slug) do update set
  name = excluded.name,
  description = excluded.description,
  updated_at = now();

-- ============================================================================
-- 2. OFFICIAL SUBSCRIPTION PLANS (`billing_plans`)
-- ============================================================================
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.billing_products(id) on delete restrict,
  slug text not null unique check (slug in ('zero', 'pulse', 'vector', 'quantum')),
  legacy_slug text not null,
  name text not null,
  subtitle text not null default '',
  description text not null default '',
  badge text,
  is_free boolean not null default false,
  status text not null default 'active' check (status in ('active', 'draft', 'archived')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  v_product_id uuid;
begin
  select id into v_product_id from public.billing_products where slug = 'asiyst-ai' limit 1;

  insert into public.billing_plans (
    product_id, slug, legacy_slug, name, subtitle, description, badge, is_free, status, display_order
  )
  values
    (
      v_product_id,
      'zero',
      'free',
      'Asiyst Zero',
      'Free foundation · 1 project & core 3D website assistant',
      'Start building with a basic AI website assistant, built-in 3D avatars, website integration, and basic knowledge support.',
      null,
      true,
      'active',
      1
    ),
    (
      v_product_id,
      'pulse',
      'starter',
      'Asiyst Pulse',
      'Individuals & small websites · Custom appearance & knowledge indexing',
      'Unlock up to 5 knowledge files, website crawling and indexing, custom assistant appearance, activity logs, and email support.',
      null,
      false,
      'active',
      2
    ),
    (
      v_product_id,
      'vector',
      'pro',
      'Asiyst Vector',
      'Growing teams · Up to 3 projects, 3 seats & scheduled recrawling',
      'Scale up to 3 projects and 3 organization seats with 50 knowledge files, scheduled recrawling, index monitoring, and priority support.',
      'Most Popular',
      false,
      'active',
      3
    ),
    (
      v_product_id,
      'quantum',
      'business',
      'Asiyst Quantum',
      'Full organization scale · 10 projects, 10 seats & Avatar Studio',
      'Maximize capacity with up to 10 projects, 10 organization seats, unlimited knowledge files, Avatar Studio, audit history, and advanced permissions.',
      'Full Scale',
      false,
      'active',
      4
    )
  on conflict (slug) do update set
    name = excluded.name,
    subtitle = excluded.subtitle,
    description = excluded.description,
    badge = excluded.badge,
    is_free = excluded.is_free,
    display_order = excluded.display_order,
    updated_at = now();
end;
$$;

-- ============================================================================
-- 3. PLAN PRICES (`billing_prices`) — Integer Minor Units Only
-- ============================================================================
create table if not exists public.billing_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  currency text not null default 'USD' check (currency = 'USD'),
  amount_minor bigint not null check (amount_minor >= 0),
  billing_interval text not null check (billing_interval in ('none', 'month')),
  provider text not null check (provider in ('internal', 'dodo')),
  provider_product_id text,
  provider_price_id text,
  environment text not null default 'test_mode' check (environment in ('test_mode', 'live_mode')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, currency, billing_interval, environment)
);

do $$
declare
  v_zero_id uuid;
  v_pulse_id uuid;
  v_vector_id uuid;
  v_quantum_id uuid;
begin
  select id into v_zero_id from public.billing_plans where slug = 'zero';
  select id into v_pulse_id from public.billing_plans where slug = 'pulse';
  select id into v_vector_id from public.billing_plans where slug = 'vector';
  select id into v_quantum_id from public.billing_plans where slug = 'quantum';

  -- Seed for both test_mode and live_mode
  insert into public.billing_prices (
    plan_id, currency, amount_minor, billing_interval, provider, environment, status
  )
  values
    (v_zero_id, 'USD', 0, 'none', 'internal', 'test_mode', 'active'),
    (v_zero_id, 'USD', 0, 'none', 'internal', 'live_mode', 'active'),
    (v_pulse_id, 'USD', 2400, 'month', 'dodo', 'test_mode', 'active'),
    (v_pulse_id, 'USD', 2400, 'month', 'dodo', 'live_mode', 'active'),
    (v_vector_id, 'USD', 5400, 'month', 'dodo', 'test_mode', 'active'),
    (v_vector_id, 'USD', 5400, 'month', 'dodo', 'live_mode', 'active'),
    (v_quantum_id, 'USD', 15400, 'month', 'dodo', 'test_mode', 'active'),
    (v_quantum_id, 'USD', 15400, 'month', 'dodo', 'live_mode', 'active')
  on conflict (plan_id, currency, billing_interval, environment) do update set
    amount_minor = excluded.amount_minor,
    provider = excluded.provider,
    updated_at = now();
end;
$$;

-- ============================================================================
-- 4. FEATURES & PLAN FEATURE MATRIX (`billing_features`, `billing_plan_features`)
-- ============================================================================
create table if not exists public.billing_features (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.billing_products(id) on delete cascade,
  feature_key text not null unique,
  name text not null,
  category text not null default 'general',
  description text not null default '',
  value_type text not null check (value_type in ('boolean', 'numeric_limit', 'tier_level')),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.billing_plan_features (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.billing_plans(id) on delete cascade,
  feature_id uuid not null references public.billing_features(id) on delete cascade,
  enabled boolean not null default true,
  limit_value bigint,
  is_unlimited boolean not null default false,
  is_unconfigured boolean not null default false,
  tier_label text,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, feature_id)
);

-- Seed canonical features and authoritative plan feature mappings
do $$
declare
  v_product_id uuid;
begin
  select id into v_product_id from public.billing_products where slug = 'asiyst-ai' limit 1;

  insert into public.billing_features (product_id, feature_key, name, category, description, value_type, display_order)
  values
    (v_product_id, 'organizations', 'Organizations', 'Organization & Access', 'Organization workspaces owned by account', 'numeric_limit', 1),
    (v_product_id, 'projects.max_count', 'Projects', 'Organization & Access', 'Maximum active projects covered by organization subscription', 'numeric_limit', 2),
    (v_product_id, 'organization.max_members', 'Organization seats', 'Organization & Access', 'Maximum organization members and billing administrators', 'numeric_limit', 3),
    (v_product_id, 'assistants.max_count', 'AI Assistants', 'Organization & Access', 'AI website assistants per project', 'numeric_limit', 4),
    (v_product_id, 'knowledge.max_files', 'Knowledge files', 'Knowledge & Website Intelligence', 'Maximum uploaded knowledge files across organization projects', 'numeric_limit', 5),
    (v_product_id, 'website.crawling', 'Website crawling', 'Knowledge & Website Intelligence', 'Website context and direct URL crawling capabilities', 'tier_level', 6),
    (v_product_id, 'website.indexing', 'Website indexing', 'Knowledge & Website Intelligence', 'Vector indexing and search over website pages', 'tier_level', 7),
    (v_product_id, 'website.scheduled_recrawling', 'Scheduled recrawling & index monitoring', 'Knowledge & Website Intelligence', 'Automated scheduled recrawling and index health monitoring', 'boolean', 8),
    (v_product_id, 'assistant.custom_welcome', 'Custom welcome message', 'Assistant Customization', 'Customizable welcome greeting for website visitors', 'tier_level', 9),
    (v_product_id, 'assistant.custom_appearance', 'Custom assistant appearance', 'Assistant Customization', 'Custom theme, colors, and visual presentation', 'tier_level', 10),
    (v_product_id, 'monitoring.activity_logs', 'Activity logs', 'Monitoring & Analytics', 'Operational activity logs and event visibility', 'tier_level', 11),
    (v_product_id, 'analytics.level', 'Analytics & reporting', 'Monitoring & Analytics', 'Traffic, conversation funnel, and advanced reporting', 'tier_level', 12),
    (v_product_id, 'avatar.capabilities', '3D Avatar capabilities', '3D Avatar & Studio', 'Built-in avatars, custom uploads, and Avatar Studio', 'tier_level', 13),
    (v_product_id, 'avatar.animations', 'Avatar animations', '3D Avatar & Studio', 'Default and advanced procedural & embedded animations', 'tier_level', 14),
    (v_product_id, 'collaboration.level', 'Team collaboration', 'Collaboration & Integrations', 'Multi-seat collaboration and project sharing', 'tier_level', 15),
    (v_product_id, 'integrations.multiple', 'Multiple integrations', 'Collaboration & Integrations', 'SDK, WordPress, and Shopify integrations', 'tier_level', 16),
    (v_product_id, 'admin.audit_history', 'Audit history', 'Administration', 'Organization-wide security and billing audit trail', 'tier_level', 17),
    (v_product_id, 'admin.advanced_permissions', 'Advanced permissions', 'Administration', 'Granular role and billing administration permissions', 'tier_level', 18),
    (v_product_id, 'support.tier', 'Customer support', 'Support', 'Support channel and response priority', 'tier_level', 19)
  on conflict (feature_key) do update set
    name = excluded.name,
    category = excluded.category,
    description = excluded.description,
    value_type = excluded.value_type,
    display_order = excluded.display_order,
    updated_at = now();
end;
$$;

-- ============================================================================
-- 5. EXTEND `public.subscriptions` AND ADD BILLING TABLES
-- ============================================================================
alter table public.subscriptions
  add column if not exists product_id uuid references public.billing_products(id) on delete restrict,
  add column if not exists plan_id uuid references public.billing_plans(id) on delete restrict,
  add column if not exists billing_interval text not null default 'month',
  add column if not exists cancelled_at timestamptz,
  add column if not exists scheduled_plan text,
  add column if not exists scheduled_change_effective_at timestamptz,
  add column if not exists first_paid_welcome_sent_at timestamptz;

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_check,
  add constraint subscriptions_plan_check
    check (plan in ('zero', 'free', 'pulse', 'starter', 'vector', 'pro', 'quantum', 'business', 'enterprise', 'custom', 'apex'));

alter table public.subscriptions
  drop constraint if exists subscriptions_status_check,
  add constraint subscriptions_status_check
    check (status in ('free', 'pending', 'trialing', 'active', 'past_due', 'paused', 'cancellation_scheduled', 'canceled', 'cancelled', 'expired', 'payment_failed', 'incomplete'));

-- Orders (`billing_orders`)
create table if not exists public.billing_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  price_id uuid references public.billing_prices(id) on delete set null,
  plan_slug text not null,
  amount_minor bigint not null check (amount_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  discount_amount_minor bigint not null default 0 check (discount_amount_minor >= 0),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending', 'completed', 'failed', 'expired', 'cancelled')),
  provider text not null default 'dodo' check (provider in ('internal', 'dodo')),
  provider_checkout_id text,
  provider_checkout_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_orders_org_idx on public.billing_orders(organization_id, created_at desc);

-- Payments (`billing_payments`)
create table if not exists public.billing_payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  order_id uuid references public.billing_orders(id) on delete set null,
  provider text not null default 'dodo' check (provider in ('dodo', 'internal')),
  provider_payment_id text not null unique,
  amount_minor bigint not null check (amount_minor >= 0),
  refunded_amount_minor bigint not null default 0 check (refunded_amount_minor >= 0),
  currency text not null default 'USD',
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded', 'partially_refunded', 'disputed')),
  payment_type text not null default 'subscription' check (payment_type in ('subscription_initial', 'subscription_renewal', 'subscription_upgrade', 'subscription')),
  invoice_number text,
  receipt_url text,
  failure_reason text,
  paid_at timestamptz,
  refunded_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_payments_org_idx on public.billing_payments(organization_id, created_at desc);

-- Webhook Events (`billing_webhook_events`)
create table if not exists public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('dodo', 'resend')),
  provider_event_id text not null unique,
  organization_id uuid references public.organizations(id) on delete set null,
  event_type text not null,
  processing_status text not null default 'received' check (processing_status in ('received', 'processing', 'processed', 'ignored', 'failed')),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists billing_webhook_events_status_idx on public.billing_webhook_events(processing_status, received_at desc);

-- Organization Billing Contacts (`organization_billing_contacts`)
create table if not exists public.organization_billing_contacts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  billing_email text not null,
  billing_name text,
  company_name text,
  tax_id text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country_code text default 'US',
  email_verified boolean not null default false,
  verified_at timestamptz,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Billing Administrator Invitations (`billing_admin_invitations`)
create table if not exists public.billing_admin_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  invited_by uuid not null references public.profiles(id) on delete cascade,
  role text not null default 'admin' check (role in ('admin', 'member')),
  can_manage_billing boolean not null default true,
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists billing_admin_invitations_org_idx on public.billing_admin_invitations(organization_id, status);

-- Durable Transactional Email Outbox (`notification_outbox`)
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  recipient_email text not null,
  event_type text not null,
  idempotency_key text not null unique,
  template_key text not null,
  subject text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'retry_scheduled', 'failed', 'dead_letter', 'skipped')),
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_at timestamptz,
  provider text not null default 'resend',
  provider_message_id text,
  delivery_status text check (delivery_status in ('accepted', 'delivered', 'bounced', 'complained', 'rejected')),
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists notification_outbox_pending_idx
  on public.notification_outbox(status, next_attempt_at)
  where status in ('pending', 'retry_scheduled');
create index if not exists notification_outbox_org_idx
  on public.notification_outbox(organization_id, created_at desc);

-- Notification Preferences (`notification_preferences`)
create table if not exists public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  notification_category text not null check (notification_category in ('billing_essential', 'usage_alerts', 'product_updates', 'marketing')),
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, notification_category)
);

-- Email Delivery Events (`email_delivery_events`)
create table if not exists public.email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid references public.notification_outbox(id) on delete set null,
  provider text not null default 'resend',
  provider_event_id text not null unique,
  provider_message_id text,
  event_type text not null check (event_type in ('accepted', 'delivered', 'bounced', 'complained', 'rejected', 'delayed')),
  recipient_email text,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

-- Subscription Change History (`subscription_change_history`)
create table if not exists public.subscription_change_history (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  change_type text not null check (change_type in ('activated_free', 'checkout_created', 'activated_paid', 'upgraded', 'downgrade_scheduled', 'downgraded', 'cancel_requested', 'cancelled', 'reactivated', 'renewed', 'payment_failed', 'payment_recovered', 'expired', 'admin_override')),
  previous_plan text,
  new_plan text,
  previous_status text,
  new_status text,
  amount_minor bigint,
  currency text default 'USD',
  provider_event_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists subscription_change_history_org_idx
  on public.subscription_change_history(organization_id, created_at desc);

-- ============================================================================
-- 6. ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================
alter table public.billing_products enable row level security;
alter table public.billing_plans enable row level security;
alter table public.billing_prices enable row level security;
alter table public.billing_features enable row level security;
alter table public.billing_plan_features enable row level security;
alter table public.billing_orders enable row level security;
alter table public.billing_payments enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.organization_billing_contacts enable row level security;
alter table public.billing_admin_invitations enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.email_delivery_events enable row level security;
alter table public.subscription_change_history enable row level security;

-- Helper: Check if authenticated user is Owner or Billing Administrator of org
create or replace function public.user_can_manage_organization_billing(org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = org_id
      and m.user_id = auth.uid()
      and (m.role = 'owner' or m.can_manage_billing = true)
  ) or exists (
    select 1
    from public.organizations o
    where o.id = org_id
      and o.owner_id = auth.uid()
  );
$$;

revoke all on function public.user_can_manage_organization_billing(uuid) from public, anon;
grant execute on function public.user_can_manage_organization_billing(uuid) to authenticated, service_role;

-- Public read access for active catalog tables
drop policy if exists billing_products_public_read on public.billing_products;
create policy billing_products_public_read on public.billing_products
  for select using (status = 'active');

drop policy if exists billing_plans_public_read on public.billing_plans;
create policy billing_plans_public_read on public.billing_plans
  for select using (status = 'active');

drop policy if exists billing_prices_public_read on public.billing_prices;
create policy billing_prices_public_read on public.billing_prices
  for select using (status = 'active');

drop policy if exists billing_features_public_read on public.billing_features;
create policy billing_features_public_read on public.billing_features
  for select using (true);

drop policy if exists billing_plan_features_public_read on public.billing_plan_features;
create policy billing_plan_features_public_read on public.billing_plan_features
  for select using (true);

-- Organization-isolated read access for billing administrators & owners
drop policy if exists billing_orders_org_billing_read on public.billing_orders;
create policy billing_orders_org_billing_read on public.billing_orders
  for select using (public.user_can_manage_organization_billing(organization_id));

drop policy if exists billing_payments_org_billing_read on public.billing_payments;
create policy billing_payments_org_billing_read on public.billing_payments
  for select using (public.user_can_manage_organization_billing(organization_id));

drop policy if exists org_billing_contacts_read on public.organization_billing_contacts;
create policy org_billing_contacts_read on public.organization_billing_contacts
  for select using (public.user_can_manage_organization_billing(organization_id));

drop policy if exists billing_admin_invitations_read on public.billing_admin_invitations;
create policy billing_admin_invitations_read on public.billing_admin_invitations
  for select using (public.user_can_manage_organization_billing(organization_id));

drop policy if exists subscription_change_history_read on public.subscription_change_history;
create policy subscription_change_history_read on public.subscription_change_history
  for select using (public.user_is_organization_member(organization_id));

drop policy if exists notification_preferences_own_access on public.notification_preferences;
create policy notification_preferences_own_access on public.notification_preferences
  for all using (auth.uid() = user_id and public.user_is_organization_member(organization_id))
  with check (auth.uid() = user_id and public.user_is_organization_member(organization_id));

-- Webhook events, notification_outbox, and email_delivery_events are strictly service_role only
revoke all on public.billing_webhook_events from anon, authenticated;
revoke all on public.notification_outbox from anon, authenticated;
revoke all on public.email_delivery_events from anon, authenticated;

-- ============================================================================
-- 7. RESTORE AUTHORITATIVE ENTITLEMENT & QUOTA ENFORCEMENT IN DATABASE
--    Ensures purchased benefits in Asiyst Plan immediately govern Asiyst-WEB,
--    and unpaid / pending checkouts never grant paid limits.
-- ============================================================================

-- 7.1 Auto-provision Asiyst Zero ('zero') on new user signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  org_id uuid;
  v_product_id uuid;
  v_zero_plan_id uuid;
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, public.profiles.full_name),
    avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url);

  insert into public.user_settings (id)
  values (new.id)
  on conflict (id) do nothing;

  select id into org_id
  from public.organizations
  where owner_id = new.id
  limit 1;

  if org_id is null then
    insert into public.organizations (name, owner_id)
    values (
      coalesce(
        nullif(trim(new.raw_user_meta_data->>'company'), ''),
        nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
        split_part(new.email, '@', 1) || '''s workspace'
      ),
      new.id
    )
    returning id into org_id;
  end if;

  insert into public.organization_members (organization_id, user_id, role, can_manage_billing)
  values (org_id, new.id, 'owner', true)
  on conflict (organization_id, user_id) do nothing;

  select id into v_product_id from public.billing_products where slug = 'asiyst-ai' limit 1;
  select id into v_zero_plan_id from public.billing_plans where slug = 'zero' limit 1;

  if not exists (
    select 1
    from public.subscriptions
    where organization_id = org_id
      and status in ('active', 'trialing', 'past_due')
  ) then
    insert into public.subscriptions (
      user_id,
      organization_id,
      product_id,
      plan_id,
      plan,
      status,
      billing_provider,
      billing_interval,
      price_minor,
      entitlement_overrides
    )
    values (
      new.id,
      org_id,
      v_product_id,
      v_zero_plan_id,
      'free',
      'active',
      null,
      'none',
      0,
      '{}'::jsonb
    );
  end if;

  return new;
end;
$$;

-- 7.2 Enforce Project Limit per Organization based on verified active Subscription
create or replace function public.assign_project_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  org_id uuid;
  max_projects integer;
begin
  if new.organization_id is null then
    select o.id into org_id
    from public.organizations o
    where o.owner_id = new.owner_id;
    new.organization_id := org_id;
  end if;

  if new.organization_id is null or not exists (
    select 1 from public.organization_members m
    where m.organization_id = new.organization_id
      and m.user_id = new.owner_id
  ) then
    raise exception using errcode = '23514', message = 'PROJECT_ORGANIZATION_MISMATCH';
  end if;

  perform 1 from public.organizations where id = new.organization_id for update;

  select coalesce(
    case
      when s.entitlement_overrides->>'projects.max_count' ~ '^[0-9]+$'
        then (s.entitlement_overrides->>'projects.max_count')::integer
      else null
    end,
    case lower(trim(s.plan))
      when 'quantum' then 10
      when 'business' then 10
      when 'vector' then 3
      when 'pro' then 3
      when 'pulse' then 1
      when 'starter' then 1
      else 1
    end
  )
  into max_projects
  from public.subscriptions s
  where s.organization_id = new.organization_id
    and (
      s.status in ('active', 'trialing', 'past_due', 'cancellation_scheduled')
      or (s.status in ('canceled', 'cancelled') and s.current_period_end > now())
    )
  order by (case when s.plan not in ('free', 'zero') then 0 else 1 end), s.updated_at desc
  limit 1;

  max_projects := coalesce(max_projects, 1);

  if tg_op = 'INSERT' or new.organization_id is distinct from old.organization_id then
    if (select count(*) from public.projects p
        where p.organization_id = new.organization_id
          and p.id <> new.id
          and p.status <> 'deleted') >= max_projects then
      raise exception using errcode = '23505', constraint = 'projects_organization_limit',
        message = 'PROJECT_LIMIT_REACHED';
    end if;
  end if;

  return new;
end;
$$;

-- 7.3 Enforce Organization Seat Limit based on verified active Subscription
create or replace function public.enforce_organization_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  max_members integer;
begin
  perform 1 from public.organizations where id = new.organization_id for update;

  select coalesce(
    case
      when s.entitlement_overrides->>'organization.max_members' ~ '^[0-9]+$'
        then (s.entitlement_overrides->>'organization.max_members')::integer
      else null
    end,
    case lower(trim(s.plan))
      when 'quantum' then 10
      when 'business' then 10
      when 'vector' then 3
      when 'pro' then 3
      when 'pulse' then 1
      when 'starter' then 1
      else 1
    end
  )
  into max_members
  from public.subscriptions s
  where s.organization_id = new.organization_id
    and (
      s.status in ('active', 'trialing', 'past_due', 'cancellation_scheduled')
      or (s.status in ('canceled', 'cancelled') and s.current_period_end > now())
    )
  order by (case when s.plan not in ('free', 'zero') then 0 else 1 end), s.updated_at desc
  limit 1;

  if (select count(*) from public.organization_members m
      where m.organization_id = new.organization_id
        and m.id <> new.id) >= coalesce(max_members, 1) then
    raise exception using errcode = '23505', constraint = 'organization_member_limit',
      message = 'ORGANIZATION_SEAT_LIMIT_REACHED';
  end if;

  return new;
end;
$$;

drop trigger if exists organization_members_enforce_seat_limit on public.organization_members;
create trigger organization_members_enforce_seat_limit
  before insert or update of organization_id on public.organization_members
  for each row execute function public.enforce_organization_seat_limit();

-- 7.4 Free Plan (Asiyst Zero) Activation RPC
create or replace function public.activate_organization_free_plan(
  p_organization_id uuid,
  p_user_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_product_id uuid;
  v_zero_plan_id uuid;
  v_sub_id uuid;
begin
  perform 1
  from public.organizations
  where id = p_organization_id
  for update;

  if not found then
    return 'organization_not_found';
  end if;

  if not exists (
    select 1
    from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_user_id
      and (role = 'owner' or can_manage_billing = true)
  ) then
    return 'not_authorized';
  end if;

  if exists (
    select 1 from public.subscriptions
    where organization_id = p_organization_id
      and plan in ('free', 'zero')
      and status in ('active', 'free')
      and billing_provider is null
  ) then
    return 'already_active';
  end if;

  if exists (
    select 1
    from public.subscriptions
    where organization_id = p_organization_id
      and plan not in ('free', 'zero')
      and (
        status in ('active', 'past_due', 'trialing', 'pending', 'paused', 'cancellation_scheduled')
        or (
          status in ('canceled', 'cancelled')
          and current_period_end > now()
        )
      )
  ) then
    return 'paid_subscription_exists';
  end if;

  select id into v_product_id from public.billing_products where slug = 'asiyst-ai' limit 1;
  select id into v_zero_plan_id from public.billing_plans where slug = 'zero' limit 1;

  insert into public.subscriptions (
    user_id,
    organization_id,
    product_id,
    plan_id,
    plan,
    status,
    billing_provider,
    billing_interval,
    price_minor,
    entitlement_overrides
  )
  values (
    p_user_id,
    p_organization_id,
    v_product_id,
    v_zero_plan_id,
    'free',
    'active',
    null,
    'none',
    0,
    '{}'::jsonb
  )
  returning id into v_sub_id;

  insert into public.subscription_change_history (
    organization_id,
    subscription_id,
    actor_user_id,
    change_type,
    previous_plan,
    new_plan,
    previous_status,
    new_status,
    amount_minor,
    currency
  )
  values (
    p_organization_id,
    v_sub_id,
    p_user_id,
    'activated_free',
    null,
    'zero',
    null,
    'active',
    0,
    'USD'
  );

  return 'activated';
end;
$$;

revoke all on function public.activate_organization_free_plan(uuid, uuid) from public, anon, authenticated;
grant execute on function public.activate_organization_free_plan(uuid, uuid) to service_role;
