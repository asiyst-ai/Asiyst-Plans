-- ============================================================================
-- Organization, Team, RBAC & Invitation Production Readiness Migration
-- ============================================================================
-- Forward-only, idempotent migration covering:
--   1. Rich organization profile, lifecycle status, soft-delete & slug uniqueness
--   2. organization_members roles (including 'manager'), status, metadata & trigger
--   3. workspace_invitations & billing_admin_invitations lifecycle, roles & partial unique indexes
--   4. audit_logs organization_id scoping & org-admin RLS
--   5. Atomic SECURITY DEFINER RPCs (create_organization_with_owner,
--      accept_workspace_invitation, accept_billing_admin_invitation,
--      transfer_organization_ownership)
--   6. Last-owner protection trigger, soft-delete/active-seat quota fixes,
--      and hardened RBAC/RLS policies.
-- ============================================================================

-- ============================================================================
-- 1. ORGANIZATIONS PROFILE & LIFECYCLE
-- ============================================================================

alter table public.organizations
  add column if not exists organization_type text default 'company',
  add column if not exists industry text,
  add column if not exists website_url text,
  add column if not exists logo_url text,
  add column if not exists legal_name text,
  add column if not exists public_name text,
  add column if not exists registration_number text,
  add column if not exists tax_id text,
  add column if not exists country_code text,
  add column if not exists region text,
  add column if not exists city text,
  add column if not exists address_line text,
  add column if not exists postal_code text,
  add column if not exists business_email text,
  add column if not exists business_phone text,
  add column if not exists primary_contact_name text,
  add column if not exists primary_contact_email text,
  add column if not exists primary_contact_phone text,
  add column if not exists primary_contact_role text,
  add column if not exists preferred_contact_method text default 'email',
  add column if not exists timezone text default 'UTC',
  add column if not exists language text default 'en',
  add column if not exists default_currency text default 'USD',
  add column if not exists notification_preferences jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists deleted_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.organizations
  drop constraint if exists organizations_status_check,
  add constraint organizations_status_check
    check (status in ('active', 'suspended', 'deactivated'));

create unique index if not exists organizations_slug_unique_idx
  on public.organizations(slug)
  where deleted_at is null;

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 2. ORGANIZATION MEMBERS ROLES, STATUS & METADATA
-- ============================================================================

alter table public.organization_members
  add column if not exists status text not null default 'active',
  add column if not exists suspended_at timestamptz,
  add column if not exists removed_at timestamptz,
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists invited_by uuid references public.profiles(id) on delete set null,
  add column if not exists invited_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists last_active_at timestamptz;

alter table public.organization_members
  drop constraint if exists organization_members_role_check,
  add constraint organization_members_role_check
    check (role in ('owner', 'admin', 'manager', 'editor', 'member', 'viewer'));

alter table public.organization_members
  drop constraint if exists organization_members_status_check,
  add constraint organization_members_status_check
    check (status in ('active', 'suspended', 'removed'));

create index if not exists organization_members_org_status_idx
  on public.organization_members(organization_id, status);

drop trigger if exists organization_members_updated_at on public.organization_members;
create trigger organization_members_updated_at
  before update on public.organization_members
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 3. WORKSPACE INVITATIONS LIFECYCLE & DEDUPLICATION
-- ============================================================================

alter table public.workspace_invitations
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null,
  add column if not exists invitee_name text,
  add column if not exists job_title text,
  add column if not exists department text,
  add column if not exists message text,
  add column if not exists can_manage_billing boolean not null default false;

alter table public.workspace_invitations
  drop constraint if exists workspace_invitations_role_check,
  add constraint workspace_invitations_role_check
    check (role in ('admin', 'manager', 'editor', 'viewer', 'member'));

create unique index if not exists workspace_invitations_pending_unique_idx
  on public.workspace_invitations (
    organization_id,
    lower(email),
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid)
  )
  where status = 'pending';

drop trigger if exists workspace_invitations_updated_at on public.workspace_invitations;
create trigger workspace_invitations_updated_at
  before update on public.workspace_invitations
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 4. BILLING ADMIN INVITATIONS LIFECYCLE & DEDUPLICATION
-- ============================================================================

alter table public.billing_admin_invitations
  add column if not exists accepted_by uuid references public.profiles(id) on delete set null,
  add column if not exists revoked_at timestamptz,
  add column if not exists revoked_by uuid references public.profiles(id) on delete set null,
  add column if not exists updated_at timestamptz not null default now();

alter table public.billing_admin_invitations
  drop constraint if exists billing_admin_invitations_role_check,
  add constraint billing_admin_invitations_role_check
    check (role in ('admin', 'manager', 'editor', 'viewer', 'member'));

create unique index if not exists billing_admin_invitations_pending_unique_idx
  on public.billing_admin_invitations (organization_id, lower(email))
  where status = 'pending';

drop trigger if exists billing_admin_invitations_updated_at on public.billing_admin_invitations;
create trigger billing_admin_invitations_updated_at
  before update on public.billing_admin_invitations
  for each row execute function public.handle_updated_at();

-- ============================================================================
-- 5. AUDIT LOGS ORGANIZATION SCOPING
-- ============================================================================

alter table public.audit_logs
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;

create index if not exists audit_logs_organization_created_idx
  on public.audit_logs(organization_id, created_at desc);

drop policy if exists audit_logs_org_admin_select on public.audit_logs;
create policy audit_logs_org_admin_select on public.audit_logs
  for select using (
    organization_id is not null
    and exists (
      select 1
      from public.organization_members om
      where om.organization_id = audit_logs.organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
        and om.role in ('owner', 'admin')
    )
  );

-- ============================================================================
-- 6. ATOMIC SECURITY DEFINER RPCS
-- ============================================================================

-- 6.1 Create organization with owner, free subscription, and audit log
create or replace function public.create_organization_with_owner(
  p_owner_id uuid,
  p_name text,
  p_slug text,
  p_description text default null,
  p_is_personal boolean default false,
  p_profile jsonb default '{}'::jsonb
)
returns public.organizations
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org public.organizations;
  v_profile jsonb := coalesce(p_profile, '{}'::jsonb);
  v_product_id uuid;
  v_zero_plan_id uuid;
begin
  if p_owner_id is null then
    raise exception 'OWNER_ID_REQUIRED' using errcode = '22004';
  end if;

  if auth.uid() is not null and auth.uid() <> p_owner_id then
    raise exception 'FORBIDDEN_OWNER_MISMATCH' using errcode = '42501';
  end if;

  if coalesce(nullif(trim(p_name), ''), '') = '' then
    raise exception 'ORGANIZATION_NAME_REQUIRED' using errcode = '22023';
  end if;

  insert into public.organizations (
    name,
    owner_id,
    slug,
    description,
    is_personal,
    organization_type,
    industry,
    website_url,
    logo_url,
    legal_name,
    public_name,
    registration_number,
    tax_id,
    country_code,
    region,
    city,
    address_line,
    postal_code,
    business_email,
    business_phone,
    primary_contact_name,
    primary_contact_email,
    primary_contact_phone,
    primary_contact_role,
    preferred_contact_method,
    timezone,
    language,
    default_currency,
    notification_preferences,
    metadata
  )
  values (
    trim(p_name),
    p_owner_id,
    nullif(trim(p_slug), ''),
    p_description,
    coalesce(p_is_personal, false),
    coalesce(nullif(trim(v_profile ->> 'organization_type'), ''), 'company'),
    nullif(trim(v_profile ->> 'industry'), ''),
    nullif(trim(v_profile ->> 'website_url'), ''),
    nullif(trim(v_profile ->> 'logo_url'), ''),
    nullif(trim(v_profile ->> 'legal_name'), ''),
    nullif(trim(v_profile ->> 'public_name'), ''),
    nullif(trim(v_profile ->> 'registration_number'), ''),
    nullif(trim(v_profile ->> 'tax_id'), ''),
    nullif(trim(v_profile ->> 'country_code'), ''),
    nullif(trim(v_profile ->> 'region'), ''),
    nullif(trim(v_profile ->> 'city'), ''),
    nullif(trim(v_profile ->> 'address_line'), ''),
    nullif(trim(v_profile ->> 'postal_code'), ''),
    nullif(trim(v_profile ->> 'business_email'), ''),
    nullif(trim(v_profile ->> 'business_phone'), ''),
    nullif(trim(v_profile ->> 'primary_contact_name'), ''),
    nullif(trim(v_profile ->> 'primary_contact_email'), ''),
    nullif(trim(v_profile ->> 'primary_contact_phone'), ''),
    nullif(trim(v_profile ->> 'primary_contact_role'), ''),
    coalesce(nullif(trim(v_profile ->> 'preferred_contact_method'), ''), 'email'),
    coalesce(nullif(trim(v_profile ->> 'timezone'), ''), 'UTC'),
    coalesce(nullif(trim(v_profile ->> 'language'), ''), 'en'),
    coalesce(nullif(trim(v_profile ->> 'default_currency'), ''), 'USD'),
    coalesce(v_profile -> 'notification_preferences', '{}'::jsonb),
    coalesce(v_profile -> 'metadata', '{}'::jsonb)
  )
  returning * into v_org;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    can_manage_billing,
    accepted_at
  )
  values (
    v_org.id,
    p_owner_id,
    'owner',
    'active',
    true,
    now()
  )
  on conflict (organization_id, user_id) do update set
    role = 'owner',
    status = 'active',
    can_manage_billing = true,
    suspended_at = null,
    removed_at = null,
    accepted_at = coalesce(public.organization_members.accepted_at, now());

  select id into v_product_id from public.billing_products where slug = 'asiyst-ai' limit 1;
  select id into v_zero_plan_id from public.billing_plans where slug = 'zero' limit 1;

  if not exists (
    select 1
    from public.subscriptions s
    where s.organization_id = v_org.id
      and s.status in ('active', 'trialing', 'past_due')
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
      p_owner_id,
      v_org.id,
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

  insert into public.audit_logs (
    user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    p_owner_id,
    v_org.id,
    'organization.created',
    'organization',
    v_org.id,
    jsonb_build_object(
      'name', v_org.name,
      'slug', v_org.slug,
      'is_personal', v_org.is_personal
    )
  );

  return v_org;
end;
$$;

revoke all on function public.create_organization_with_owner(uuid, text, text, text, boolean, jsonb) from public, anon;
grant execute on function public.create_organization_with_owner(uuid, text, text, text, boolean, jsonb) to authenticated, service_role;

-- 6.2 Atomically accept a workspace invitation
create or replace function public.accept_workspace_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inv public.workspace_invitations;
begin
  if p_token_hash is null or trim(p_token_hash) = '' or p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'status', 400);
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'FORBIDDEN_USER_MISMATCH' using errcode = '42501';
  end if;

  select * into v_inv
  from public.workspace_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_FOUND', 'status', 404);
  end if;

  if v_inv.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', 'INVITATION_NOT_PENDING',
      'invitation_status', v_inv.status,
      'status', 409
    );
  end if;

  if v_inv.expires_at <= now() then
    update public.workspace_invitations
    set status = 'expired',
        updated_at = now()
    where id = v_inv.id;

    return jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED', 'status', 410);
  end if;

  if coalesce(nullif(trim(p_user_email), ''), '') = ''
     or lower(trim(v_inv.email)) <> lower(trim(p_user_email)) then
    return jsonb_build_object('ok', false, 'error', 'INVITATION_EMAIL_MISMATCH', 'status', 403);
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    can_manage_billing,
    permissions,
    job_title,
    department,
    invited_by,
    invited_at,
    accepted_at
  )
  values (
    v_inv.organization_id,
    p_user_id,
    v_inv.role,
    'active',
    v_inv.can_manage_billing,
    coalesce(v_inv.permissions, '{}'::jsonb),
    v_inv.job_title,
    v_inv.department,
    v_inv.invited_by,
    v_inv.created_at,
    now()
  )
  on conflict (organization_id, user_id) do update set
    role = case
      when public.organization_members.role = 'owner' then 'owner'
      else excluded.role
    end,
    status = 'active',
    suspended_at = null,
    removed_at = null,
    can_manage_billing = public.organization_members.can_manage_billing or excluded.can_manage_billing,
    permissions = coalesce(public.organization_members.permissions, '{}'::jsonb) || coalesce(excluded.permissions, '{}'::jsonb),
    job_title = coalesce(excluded.job_title, public.organization_members.job_title),
    department = coalesce(excluded.department, public.organization_members.department),
    accepted_at = now();

  if v_inv.project_id is not null then
    insert into public.project_members (
      project_id,
      user_id,
      role,
      invited_by,
      permissions
    )
    values (
      v_inv.project_id,
      p_user_id,
      case when v_inv.role = 'manager' then 'admin' else v_inv.role end,
      v_inv.invited_by,
      coalesce(v_inv.permissions, '{}'::jsonb)
    )
    on conflict (project_id, user_id) do update set
      role = excluded.role,
      permissions = coalesce(public.project_members.permissions, '{}'::jsonb) || coalesce(excluded.permissions, '{}'::jsonb);
  end if;

  update public.workspace_invitations
  set status = 'accepted',
      accepted_by = p_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = v_inv.id;

  insert into public.audit_logs (
    user_id,
    organization_id,
    project_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    p_user_id,
    v_inv.organization_id,
    v_inv.project_id,
    'workspace_invitation.accepted',
    'workspace_invitation',
    v_inv.id,
    jsonb_build_object(
      'email', v_inv.email,
      'role', v_inv.role,
      'project_id', v_inv.project_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role,
    'project_id', v_inv.project_id
  );
end;
$$;

revoke all on function public.accept_workspace_invitation(text, uuid, text) from public, anon;
grant execute on function public.accept_workspace_invitation(text, uuid, text) to authenticated, service_role;

-- 6.3 Atomically accept a billing admin invitation
create or replace function public.accept_billing_admin_invitation(
  p_token_hash text,
  p_user_id uuid,
  p_user_email text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_inv public.billing_admin_invitations;
begin
  if p_token_hash is null or trim(p_token_hash) = '' or p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'status', 400);
  end if;

  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'FORBIDDEN_USER_MISMATCH' using errcode = '42501';
  end if;

  select * into v_inv
  from public.billing_admin_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'INVITATION_NOT_FOUND', 'status', 404);
  end if;

  if v_inv.status <> 'pending' then
    return jsonb_build_object(
      'ok', false,
      'error', 'INVITATION_NOT_PENDING',
      'invitation_status', v_inv.status,
      'status', 409
    );
  end if;

  if v_inv.expires_at <= now() then
    update public.billing_admin_invitations
    set status = 'expired',
        updated_at = now()
    where id = v_inv.id;

    return jsonb_build_object('ok', false, 'error', 'INVITATION_EXPIRED', 'status', 410);
  end if;

  if coalesce(nullif(trim(p_user_email), ''), '') = ''
     or lower(trim(v_inv.email)) <> lower(trim(p_user_email)) then
    return jsonb_build_object('ok', false, 'error', 'INVITATION_EMAIL_MISMATCH', 'status', 403);
  end if;

  insert into public.organization_members (
    organization_id,
    user_id,
    role,
    status,
    can_manage_billing,
    permissions,
    invited_by,
    invited_at,
    accepted_at
  )
  values (
    v_inv.organization_id,
    p_user_id,
    v_inv.role,
    'active',
    true,
    jsonb_build_object('billing_only', true),
    v_inv.invited_by,
    v_inv.created_at,
    now()
  )
  on conflict (organization_id, user_id) do update set
    status = 'active',
    suspended_at = null,
    removed_at = null,
    can_manage_billing = true,
    accepted_at = coalesce(public.organization_members.accepted_at, now());

  update public.billing_admin_invitations
  set status = 'accepted',
      accepted_by = p_user_id,
      accepted_at = now(),
      updated_at = now()
  where id = v_inv.id;

  insert into public.audit_logs (
    user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    p_user_id,
    v_inv.organization_id,
    'billing_admin_invitation.accepted',
    'billing_admin_invitation',
    v_inv.id,
    jsonb_build_object(
      'email', v_inv.email,
      'role', v_inv.role,
      'can_manage_billing', true
    )
  );

  return jsonb_build_object(
    'ok', true,
    'organization_id', v_inv.organization_id,
    'role', v_inv.role,
    'can_manage_billing', true
  );
end;
$$;

revoke all on function public.accept_billing_admin_invitation(text, uuid, text) from public, anon;
grant execute on function public.accept_billing_admin_invitation(text, uuid, text) to authenticated, service_role;

-- 6.4 Atomically transfer organization ownership
create or replace function public.transfer_organization_ownership(
  p_organization_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org public.organizations;
  v_actor public.organization_members;
  v_target public.organization_members;
begin
  if p_organization_id is null or p_actor_user_id is null or p_target_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'INVALID_ARGUMENTS', 'status', 400);
  end if;

  if auth.uid() is not null and auth.uid() <> p_actor_user_id then
    raise exception 'FORBIDDEN_USER_MISMATCH' using errcode = '42501';
  end if;

  if p_actor_user_id = p_target_user_id then
    return jsonb_build_object('ok', false, 'error', 'CANNOT_TRANSFER_TO_SELF', 'status', 400);
  end if;

  select * into v_org
  from public.organizations
  where id = p_organization_id
  for update;

  if not found or v_org.deleted_at is not null then
    return jsonb_build_object('ok', false, 'error', 'ORGANIZATION_NOT_FOUND', 'status', 404);
  end if;

  select * into v_actor
  from public.organization_members
  where organization_id = p_organization_id
    and user_id = p_actor_user_id
    and status = 'active'
    and role = 'owner'
  for update;

  if not found or v_org.owner_id <> p_actor_user_id then
    return jsonb_build_object('ok', false, 'error', 'FORBIDDEN_NOT_OWNER', 'status', 403);
  end if;

  select * into v_target
  from public.organization_members
  where organization_id = p_organization_id
    and user_id = p_target_user_id
    and status = 'active'
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'TARGET_NOT_ACTIVE_MEMBER', 'status', 404);
  end if;

  perform set_config('app.allow_owner_transfer', 'true', true);

  update public.organizations
  set owner_id = p_target_user_id,
      updated_at = now()
  where id = p_organization_id;

  update public.organization_members
  set role = 'owner',
      can_manage_billing = true,
      updated_at = now()
  where id = v_target.id;

  update public.organization_members
  set role = 'admin',
      updated_at = now()
  where id = v_actor.id;

  perform set_config('app.allow_owner_transfer', 'false', true);

  insert into public.audit_logs (
    user_id,
    organization_id,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    p_actor_user_id,
    p_organization_id,
    'organization.ownership_transferred',
    'organization',
    p_organization_id,
    jsonb_build_object(
      'from_user_id', p_actor_user_id,
      'to_user_id', p_target_user_id
    )
  );

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'previous_owner_id', p_actor_user_id,
    'new_owner_id', p_target_user_id
  );
end;
$$;

revoke all on function public.transfer_organization_ownership(uuid, uuid, uuid) from public, anon;
grant execute on function public.transfer_organization_ownership(uuid, uuid, uuid) to authenticated, service_role;

-- ============================================================================
-- 7. TRIGGERS & RLS FIXES
-- ============================================================================

-- 7.1 Protect last active organization owner from deletion, demotion, or suspension
create or replace function public.protect_last_organization_owner()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_other_owners integer;
begin
  if old.role = 'owner' and old.status = 'active' then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and (new.role <> 'owner' or new.status <> 'active')) then
      if current_setting('app.allow_owner_transfer', true) = 'true' then
        if tg_op = 'DELETE' then
          return old;
        end if;
        return new;
      end if;

      select count(*) into v_other_owners
      from public.organization_members m
      where m.organization_id = old.organization_id
        and m.role = 'owner'
        and m.status = 'active'
        and m.id <> old.id;

      if v_other_owners = 0 then
        raise exception 'CANNOT_REMOVE_LAST_ORGANIZATION_OWNER'
          using errcode = 'P0001';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop trigger if exists organization_members_protect_last_owner on public.organization_members;
create trigger organization_members_protect_last_owner
  before delete or update on public.organization_members
  for each row execute function public.protect_last_organization_owner();

-- 7.2 Exclude soft-deleted and deactivated organizations from workspace creation limit
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
  where o.owner_id = new.owner_id
    and o.deleted_at is null
    and o.status <> 'deactivated';

  -- First active workspace for any user is always permitted
  if v_existing_count = 0 then
    new.is_personal := true;
    return new;
  end if;

  -- Determine highest workspace allowance across user's active owned organizations
  for v_org in
    select id
    from public.organizations
    where owner_id = new.owner_id
      and deleted_at is null
      and status <> 'deactivated'
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

-- 7.3 Count only active members in organization seat limit enforcement
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
  if new.status <> 'active' then
    return new;
  end if;

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
    and m.status = 'active'
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
  before insert or update of organization_id, status on public.organization_members
  for each row execute function public.enforce_organization_seat_limit();

-- 7.4 Require active membership & align RBAC helpers with owner/admin/manager roles
create or replace function public.user_is_organization_member(org_id uuid)
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
      and m.status = 'active'
  );
$$;

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
            and o.deleted_at is null
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
            and om.status = 'active'
            and coalesce((om.permissions ->> 'billing_only')::boolean, false) = false
            and (
              om.role in ('owner', 'admin')
              or (
                om.role in ('manager', 'editor', 'member', 'viewer')
                and coalesce((om.permissions ->> 'all_projects_access')::boolean, false) = true
              )
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
            and o.deleted_at is null
        )
        or exists (
          select 1
          from public.project_members pm
          where pm.project_id = p.id
            and pm.user_id = auth.uid()
            and pm.role in ('owner', 'admin', 'manager', 'editor')
        )
        or exists (
          select 1
          from public.organization_members om
          where om.organization_id = p.organization_id
            and om.user_id = auth.uid()
            and om.status = 'active'
            and coalesce((om.permissions ->> 'billing_only')::boolean, false) = false
            and (
              om.role in ('owner', 'admin')
              or (
                om.role in ('manager', 'editor')
                and coalesce((om.permissions ->> 'all_projects_access')::boolean, false) = true
              )
            )
        )
      )
  );
$$;

-- 7.5 Harden workspace_invitations, project_members & projects RLS policies
drop policy if exists workspace_invitations_org_read on public.workspace_invitations;
create policy workspace_invitations_org_read on public.workspace_invitations
  for select using (
    exists (
      select 1
      from public.organization_members om
      where om.organization_id = workspace_invitations.organization_id
        and om.user_id = auth.uid()
        and om.status = 'active'
        and om.role in ('owner', 'admin', 'manager')
    )
  );

drop policy if exists "project_members_insert" on public.project_members;
create policy "project_members_insert" on public.project_members
  for insert with check (public.user_can_manage_project(project_id));

drop policy if exists "project_members_update" on public.project_members;
create policy "project_members_update" on public.project_members
  for update
  using (public.user_can_manage_project(project_id))
  with check (public.user_can_manage_project(project_id));

drop policy if exists "project_members_delete" on public.project_members;
create policy "project_members_delete" on public.project_members
  for delete using (public.user_can_manage_project(project_id));

drop policy if exists "projects_update" on public.projects;
create policy "projects_update" on public.projects
  for update
  to authenticated
  using (public.user_can_manage_project(id))
  with check (public.user_can_manage_project(id));
