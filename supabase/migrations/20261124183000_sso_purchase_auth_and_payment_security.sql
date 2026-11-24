-- ============================================================================
-- Migration: 20261124183000_sso_purchase_auth_and_payment_security.sql
-- Project: Asiyst Subscription Platform (Asiyst-WEB + Asiyst-Plans)
-- Description:
--   1. Creates `public.plan_sso_handoffs` for single-use, 60-120s server-verified
--      SSO authorization codes between `asiyst.com` and `plan.asiyst.com`.
--   2. Creates `public.plan_purchase_authorizations` separating the temporary
--      15-minute subscription purchase authorization from the user's primary
--      `asiyst.com` dashboard login session.
--   3. Creates atomic RPC `public.consume_plan_sso_handoff` to validate, lock,
--      and single-use-consume SSO codes and mint purchase authorizations.
--   4. Extends `public.billing_orders` (purchase intents) and `public.billing_payments`
--      with explicit payment state machine columns, idempotency keys, and
--      unique partial indexes preventing concurrent duplicate checkouts/charges.
--   5. Adds unique partial indexes on `public.subscriptions` preventing duplicate
--      active paid subscriptions per organization.
--   6. Creates append-only `public.billing_payment_events` audit log and
--      `public.billing_invoices` with unique one-invoice-per-payment guarantees.
-- ============================================================================

-- ============================================================================
-- 1. CROSS-DOMAIN SINGLE-USE SSO HANDOFFS (`plan_sso_handoffs`)
-- ============================================================================
create table if not exists public.plan_sso_handoffs (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  destination_path text not null default '/plans',
  selected_plan text,
  source text not null default 'dashboard_settings'
    check (source in ('direct_plan_login', 'dashboard_settings', 'reauth')),
  state_nonce text,
  status text not null default 'issued'
    check (status in ('issued', 'consumed', 'expired', 'revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 seconds'),
  consumed_at timestamptz,
  client_ip_hash text,
  user_agent_hash text,
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists plan_sso_handoffs_user_idx
  on public.plan_sso_handoffs(user_id, issued_at desc);
create index if not exists plan_sso_handoffs_status_exp_idx
  on public.plan_sso_handoffs(status, expires_at)
  where status = 'issued';

alter table public.plan_sso_handoffs enable row level security;
revoke all on public.plan_sso_handoffs from public, anon, authenticated;
grant all on public.plan_sso_handoffs to service_role;

-- ============================================================================
-- 2. SHORT-LIVED PURCHASE AUTHORIZATIONS (`plan_purchase_authorizations`)
--    Separates 15-minute purchase capability from primary Asiyst-WEB login.
-- ============================================================================
create table if not exists public.plan_purchase_authorizations (
  id uuid primary key default gen_random_uuid(),
  sso_handoff_id uuid unique references public.plan_sso_handoffs(id) on delete set null,
  session_token_hash text not null unique,
  purchase_token_hash text not null unique,
  user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete cascade,
  intended_plan text,
  status text not null default 'active'
    check (status in ('active', 'checkout_initiated', 'completed', 'expired', 'abandoned', 'revoked')),
  issued_at timestamptz not null default now(),
  purchase_expires_at timestamptz not null default (now() + interval '15 minutes'),
  account_expires_at timestamptz not null default (now() + interval '2 hours'),
  completed_at timestamptz,
  abandoned_at timestamptz,
  revoked_at timestamptz,
  last_verified_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists plan_purchase_auth_user_idx
  on public.plan_purchase_authorizations(user_id, issued_at desc);
create index if not exists plan_purchase_auth_active_idx
  on public.plan_purchase_authorizations(status, purchase_expires_at)
  where status in ('active', 'checkout_initiated');

alter table public.plan_purchase_authorizations enable row level security;
revoke all on public.plan_purchase_authorizations from public, anon, authenticated;
grant all on public.plan_purchase_authorizations to service_role;

-- ============================================================================
-- 3. ATOMIC SINGLE-USE SSO CODE CONSUMPTION RPC
-- ============================================================================
create or replace function public.consume_plan_sso_handoff(
  p_code_hash text,
  p_session_token_hash text,
  p_purchase_token_hash text,
  p_purchase_ttl_seconds integer default 900,
  p_account_ttl_seconds integer default 7200
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_handoff public.plan_sso_handoffs%rowtype;
  v_auth_id uuid;
  v_now timestamptz := now();
  v_purchase_exp timestamptz;
  v_account_exp timestamptz;
begin
  if p_code_hash is null or length(trim(p_code_hash)) < 32 then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SSO_CODE');
  end if;

  select *
  into v_handoff
  from public.plan_sso_handoffs
  where code_hash = p_code_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'INVALID_SSO_CODE');
  end if;

  if v_handoff.status = 'consumed' or v_handoff.consumed_at is not null then
    return jsonb_build_object('ok', false, 'code', 'SSO_CODE_ALREADY_USED');
  end if;

  if v_handoff.status = 'revoked' then
    return jsonb_build_object('ok', false, 'code', 'SSO_CODE_REVOKED');
  end if;

  if v_handoff.status = 'expired' or v_handoff.expires_at <= v_now then
    update public.plan_sso_handoffs
    set status = 'expired'
    where id = v_handoff.id and status = 'issued';
    return jsonb_build_object('ok', false, 'code', 'SSO_CODE_EXPIRED');
  end if;

  update public.plan_sso_handoffs
  set status = 'consumed',
      consumed_at = v_now
  where id = v_handoff.id;

  -- Mark any previously uncompleted purchase authorizations for this user as abandoned
  update public.plan_purchase_authorizations
  set status = case when purchase_expires_at <= v_now then 'expired' else 'abandoned' end,
      abandoned_at = coalesce(abandoned_at, v_now)
  where user_id = v_handoff.user_id
    and status in ('active', 'checkout_initiated');

  v_purchase_exp := v_now + make_interval(secs => greatest(60, least(p_purchase_ttl_seconds, 900)));
  v_account_exp := v_now + make_interval(secs => greatest(300, least(p_account_ttl_seconds, 14400)));

  insert into public.plan_purchase_authorizations (
    sso_handoff_id,
    session_token_hash,
    purchase_token_hash,
    user_id,
    organization_id,
    intended_plan,
    status,
    issued_at,
    purchase_expires_at,
    account_expires_at,
    last_verified_at,
    metadata
  )
  values (
    v_handoff.id,
    p_session_token_hash,
    p_purchase_token_hash,
    v_handoff.user_id,
    v_handoff.organization_id,
    v_handoff.selected_plan,
    'active',
    v_now,
    v_purchase_exp,
    v_account_exp,
    v_now,
    jsonb_build_object('source', v_handoff.source)
  )
  returning id into v_auth_id;

  return jsonb_build_object(
    'ok', true,
    'handoff_id', v_handoff.id,
    'purchase_authorization_id', v_auth_id,
    'user_id', v_handoff.user_id,
    'organization_id', v_handoff.organization_id,
    'destination_path', v_handoff.destination_path,
    'selected_plan', v_handoff.selected_plan,
    'state_nonce', v_handoff.state_nonce,
    'purchase_expires_at', v_purchase_exp,
    'account_expires_at', v_account_exp
  );
end;
$$;

revoke all on function public.consume_plan_sso_handoff(text, text, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_plan_sso_handoff(text, text, text, integer, integer)
  to service_role;

-- ============================================================================
-- 4. PURCHASE INTENTS, PAYMENT STATE MACHINE & ANTI-DOUBLE-PAYMENT CONSTRAINTS
-- ============================================================================
alter table public.billing_orders
  alter column plan_id drop not null;

alter table public.billing_orders
  add column if not exists purchase_authorization_id uuid
    references public.plan_purchase_authorizations(id) on delete set null,
  add column if not exists idempotency_key text,
  add column if not exists payment_state text not null default 'created',
  add column if not exists expires_at timestamptz not null default (now() + interval '30 minutes'),
  add column if not exists completed_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists last_reconciled_at timestamptz;

alter table public.billing_orders
  drop constraint if exists billing_orders_payment_state_check,
  add constraint billing_orders_payment_state_check
    check (payment_state in (
      'created',
      'checkout_pending',
      'processing',
      'payment_pending',
      'payment_succeeded',
      'payment_failed',
      'payment_cancelled',
      'expired',
      'refund_pending',
      'refunded',
      'disputed'
    ));

alter table public.billing_orders
  drop constraint if exists billing_orders_status_check,
  add constraint billing_orders_status_check
    check (status in ('pending', 'processing', 'completed', 'failed', 'expired', 'cancelled', 'refunded', 'disputed'));

create unique index if not exists billing_orders_idempotency_key_uidx
  on public.billing_orders(idempotency_key)
  where idempotency_key is not null;

create unique index if not exists billing_orders_provider_checkout_uidx
  on public.billing_orders(provider_checkout_id)
  where provider_checkout_id is not null;

-- Prevent concurrent active checkout attempts for the same organization at the database level
create unique index if not exists billing_orders_one_active_checkout_per_org_idx
  on public.billing_orders(organization_id)
  where payment_state in ('created', 'checkout_pending', 'processing', 'payment_pending')
    and status in ('pending', 'processing');

-- Extend `billing_payments`
alter table public.billing_payments
  add column if not exists user_id uuid references public.profiles(id) on delete set null,
  add column if not exists attempt_number integer not null default 1 check (attempt_number >= 1),
  add column if not exists idempotency_key text,
  add column if not exists payment_state text not null default 'payment_pending',
  add column if not exists activated_subscription_id uuid references public.subscriptions(id) on delete set null;

alter table public.billing_payments
  drop constraint if exists billing_payments_status_check,
  add constraint billing_payments_status_check
    check (status in (
      'pending',
      'processing',
      'succeeded',
      'failed',
      'cancelled',
      'expired',
      'refund_pending',
      'refunded',
      'partially_refunded',
      'disputed'
    ));

alter table public.billing_payments
  drop constraint if exists billing_payments_payment_state_check,
  add constraint billing_payments_payment_state_check
    check (payment_state in (
      'created',
      'checkout_pending',
      'processing',
      'payment_pending',
      'payment_succeeded',
      'payment_failed',
      'payment_cancelled',
      'expired',
      'refund_pending',
      'refunded',
      'disputed'
    ));

create unique index if not exists billing_payments_idempotency_key_uidx
  on public.billing_payments(idempotency_key)
  where idempotency_key is not null;

-- Prevent multiple active paid subscriptions for the same organization at DB level
create unique index if not exists subscriptions_dodo_subscription_uidx
  on public.subscriptions(dodo_subscription_id)
  where dodo_subscription_id is not null;

-- Expand `subscription_change_history` change_type check to cover refunds & disputes
alter table public.subscription_change_history
  drop constraint if exists subscription_change_history_change_type_check,
  add constraint subscription_change_history_change_type_check
    check (change_type in (
      'activated_free',
      'checkout_created',
      'activated_paid',
      'upgraded',
      'downgrade_scheduled',
      'downgraded',
      'cancel_requested',
      'cancelled',
      'reactivated',
      'renewed',
      'payment_failed',
      'payment_recovered',
      'refunded',
      'disputed',
      'expired',
      'admin_override'
    ));

-- ============================================================================
-- 5. IMMUTABLE PAYMENT AUDIT LOG (`billing_payment_events`)
-- ============================================================================
create table if not exists public.billing_payment_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  order_id uuid references public.billing_orders(id) on delete set null,
  payment_id uuid references public.billing_payments(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  previous_state text,
  new_state text not null,
  event_source text not null
    check (event_source in (
      'checkout_api',
      'dodo_webhook',
      'provider_reconciliation',
      'system_expiry',
      'user_cancel'
    )),
  provider_event_id text,
  amount_minor bigint,
  currency text default 'USD',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists billing_payment_events_org_idx
  on public.billing_payment_events(organization_id, created_at desc);
create index if not exists billing_payment_events_order_idx
  on public.billing_payment_events(order_id, created_at asc);

create or replace function public.prevent_payment_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'billing_payment_events is an immutable financial audit log and cannot be modified or deleted.';
end;
$$;

drop trigger if exists billing_payment_events_immutable_trg on public.billing_payment_events;
create trigger billing_payment_events_immutable_trg
  before update or delete on public.billing_payment_events
  for each row execute function public.prevent_payment_event_mutation();

alter table public.billing_payment_events enable row level security;
drop policy if exists billing_payment_events_org_billing_read on public.billing_payment_events;
create policy billing_payment_events_org_billing_read on public.billing_payment_events
  for select using (public.user_can_manage_organization_billing(organization_id));
revoke insert, update, delete on public.billing_payment_events from anon, authenticated;

-- ============================================================================
-- 6. STRUCTURED INVOICES & OFFICIAL RECEIPTS (`billing_invoices`)
-- ============================================================================
create table if not exists public.billing_invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_number text not null unique,
  document_type text not null default 'payment_receipt'
    check (document_type in ('payment_receipt', 'tax_invoice')),
  organization_id uuid not null references public.organizations(id) on delete restrict,
  user_id uuid references public.profiles(id) on delete set null,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  order_id uuid references public.billing_orders(id) on delete set null,
  payment_id uuid unique references public.billing_payments(id) on delete restrict,
  provider_payment_id text unique,
  plan_slug text not null,
  plan_name text not null,
  plan_description text not null default '',
  quantity integer not null default 1 check (quantity = 1),
  subtotal_minor bigint not null check (subtotal_minor >= 0),
  tax_amount_minor bigint not null default 0 check (tax_amount_minor >= 0),
  discount_amount_minor bigint not null default 0 check (discount_amount_minor >= 0),
  total_amount_minor bigint not null check (total_amount_minor >= 0),
  refunded_amount_minor bigint not null default 0 check (refunded_amount_minor >= 0),
  currency text not null default 'USD',
  status text not null default 'paid'
    check (status in ('paid', 'refunded', 'partially_refunded', 'void', 'disputed')),
  seller_details jsonb not null default '{}'::jsonb,
  customer_details jsonb not null default '{}'::jsonb,
  issued_at timestamptz not null default now(),
  paid_at timestamptz not null default now(),
  period_start timestamptz,
  period_end timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists billing_invoices_org_idx
  on public.billing_invoices(organization_id, issued_at desc);

alter table public.billing_invoices enable row level security;
drop policy if exists billing_invoices_org_billing_read on public.billing_invoices;
create policy billing_invoices_org_billing_read on public.billing_invoices
  for select using (public.user_can_manage_organization_billing(organization_id));
revoke insert, update, delete on public.billing_invoices from anon, authenticated;
