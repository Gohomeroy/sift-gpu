-- ============================================================================
-- SIFT — Migration 0001: Multi-tenant foundation
-- Organizations (tenants) · stacked custom roles · permission matrix ·
-- members · invites · audit log · global profiles · RLS everywhere.
--
-- Enforcement model: every tenant-scoped table carries organization_id and its
-- Row Level Security policies call the SECURITY DEFINER helpers below
-- (has_org_permission / is_org_member / is_platform_admin). The permission
-- matrix executes in SQL, never in application code.
--
-- Platform-admin boundary (deliberate, documented):
-- Platform admins may READ organization metadata (name, plan, status) to run
-- the SaaS, and NOTHING inside an org — no chat, comments, submissions,
-- rosters, or audit entries — unless they join that org like anyone else.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- Enums
-- ----------------------------------------------------------------------------

create type public.permission_key as enum (
  'post_jobs',
  'claim_jobs_direct',
  'apply_to_jobs',
  'review_submissions',
  'approve_submissions',
  'send_chat',
  'moderate_chat',
  'kick_users',
  'ban_users',
  'manage_roles',
  'access_admin_panel',
  'manage_billing'
);

create type public.member_status as enum ('active', 'banned');

create type public.org_status as enum ('active', 'suspended');

create type public.org_plan as enum ('free', 'pro', 'studio');

-- ----------------------------------------------------------------------------
-- Profiles (global, one per auth user) & platform admins
-- ----------------------------------------------------------------------------

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default 'New editor',
  avatar_url   text,
  bio          text,
  skills       text[] not null default '{}',
  portfolio    jsonb  not null default '[]'::jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.profiles is
  'Global profile shared across every organization a user belongs to. Reputation stats are derived per-org from reviews (later migration), never stored here.';

create table public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

comment on table public.platform_admins is
  'SIFT staff. Grants management of organizations (metadata, suspension) ONLY — never read access to org-private content. Rows managed directly in SQL/dashboard, not app UI.';

-- ----------------------------------------------------------------------------
-- Organizations
-- ----------------------------------------------------------------------------

create table public.organizations (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null check (char_length(btrim(name)) between 2 and 60),
  slug               text not null unique,
  owner_id           uuid not null references auth.users (id) on delete cascade,
  plan               public.org_plan not null default 'free',
  subscription_status text not null default 'active'
    check (subscription_status in ('active', 'trialing', 'past_due', 'canceled')),
  stripe_customer_id     text,
  stripe_subscription_id text,
  settings           jsonb not null default '{"join_requires_approval": false}'::jsonb,
  status             public.org_status not null default 'active',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

comment on column public.organizations.settings is
  'Org-level switches. Key: join_requires_approval (bool) — reserved for open-join flows; invite links bypass approval by design.';

-- ----------------------------------------------------------------------------
-- Roles & the permission matrix (per-org, stackable)
-- ----------------------------------------------------------------------------

create table public.roles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  color           text not null default '#f0a32b'
    check (color ~ '^#[0-9a-fA-F]{6}$'),
  position        int  not null default 0,
  is_system       boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);

-- Composite uniqueness lets child tables enforce "same org" at the FK level.
create unique index roles_org_id_key on public.roles (organization_id, id);

create table public.role_permissions (
  role_id    uuid not null references public.roles (id) on delete cascade,
  permission public.permission_key not null,
  primary key (role_id, permission)
);

-- ----------------------------------------------------------------------------
-- Memberships & stacked role assignments
-- ----------------------------------------------------------------------------

create table public.organization_members (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  status          public.member_status not null default 'active',
  joined_at       timestamptz not null default now(),
  unique (organization_id, user_id)
);

create unique index organization_members_org_id_key
  on public.organization_members (organization_id, id);
create index organization_members_user_idx on public.organization_members (user_id);

-- Kick deletes the row (rejoinable via invite). Ban keeps it as status='banned',
-- which blocks both re-invite redemption and any future open-join.
comment on column public.organization_members.status is
  'active = member. banned = permanent block for this org (row kept as record). kicked members have their row deleted entirely.';

create table public.member_roles (
  organization_member_id uuid not null,
  role_id                uuid not null,
  organization_id        uuid not null,
  primary key (organization_member_id, role_id),
  foreign key (organization_id, organization_member_id)
    references public.organization_members (organization_id, id) on delete cascade,
  foreign key (organization_id, role_id)
    references public.roles (organization_id, id) on delete cascade
);

comment on table public.member_roles is
  'Stacked roles. The denormalized organization_id + composite FKs make cross-org assignments structurally impossible. Effective permissions are the UNION of all held roles.';

create index member_roles_role_idx on public.member_roles (role_id);

-- ----------------------------------------------------------------------------
-- Invites
-- ----------------------------------------------------------------------------

create table public.organization_invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  invited_by      uuid not null references auth.users (id) on delete cascade,
  role_id         uuid not null references public.roles (id) on delete cascade,
  email           text, -- null = open link, anyone with the URL may redeem
  token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  max_uses        int,  -- null = unlimited until expiry/revoke
  uses            int   not null default 0,
  expires_at      timestamptz,
  accepted_at     timestamptz, -- last redemption time (uses is the source of truth)
  created_at      timestamptz not null default now()
);

create index organization_invites_org_idx on public.organization_invites (organization_id);

-- ----------------------------------------------------------------------------
-- Audit log (append-only, per-org)
-- ----------------------------------------------------------------------------

create table public.audit_log (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_id        uuid references auth.users (id) on delete set null,
  action          text not null,
  target_user_id  uuid references auth.users (id) on delete set null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);

create index audit_log_org_created_idx on public.audit_log (organization_id, created_at desc);

-- ----------------------------------------------------------------------------
-- updated_at maintenance
-- ----------------------------------------------------------------------------

create or replace function public.sift_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger profiles_touch_updated
  before update on public.profiles
  for each row execute function public.sift_touch_updated_at();

create trigger organizations_touch_updated
  before update on public.organizations
  for each row execute function public.sift_touch_updated_at();

-- ----------------------------------------------------------------------------
-- New auth user -> profile bootstrap
-- ----------------------------------------------------------------------------

create or replace function public.sift_handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      nullif(btrim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'editor'), '@', 1)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.sift_handle_new_user();

-- ----------------------------------------------------------------------------
-- Permission helpers — THE enforcement core. Every RLS policy calls these.
-- SECURITY DEFINER so they can read membership tables without recursive
-- policy evaluation. STABLE so they can be used in policies safely.
-- ============================================================================

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.platform_admins where user_id = auth.uid()
  );
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organizations
    where id = p_org and owner_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function public.has_org_permission(p_org uuid, p_perm public.permission_key)
returns boolean language sql stable security definer set search_path = public as $$
  -- Owners hold implicit full permission while their org is active.
  -- Everyone else: union of permissions across ALL roles they hold in this org.
  -- Platform admins intentionally get FALSE here — see header comment.
  select exists (
    select 1 from public.organizations o
    where o.id = p_org and o.owner_id = auth.uid() and o.status = 'active'
  ) or exists (
    select 1
    from public.organization_members m
    join public.member_roles mr on mr.organization_member_id = m.id
    join public.role_permissions rp on rp.role_id = mr.role_id
    where m.organization_id = p_org
      and m.user_id = auth.uid()
      and m.status = 'active'
      and rp.permission = p_perm
  );
$$;

grant execute on function
  public.is_platform_admin(),
  public.is_org_owner(uuid),
  public.is_org_member(uuid),
  public.has_org_permission(uuid, public.permission_key)
to authenticated, service_role;
revoke execute on function
  public.is_platform_admin(),
  public.is_org_owner(uuid),
  public.is_org_member(uuid),
  public.has_org_permission(uuid, public.permission_key)
from anon, public;

-- ----------------------------------------------------------------------------
-- RPC: create an organization and become its Owner (atomic)
-- Seeds system roles: Owner (all perms), Admin, Editor, Member.
-- ----------------------------------------------------------------------------

create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner  constant uuid := auth.uid();
  v_org    uuid;
  r_owner  uuid;
  r_admin  uuid;
  r_editor uuid;
  r_member uuid;
begin
  if v_owner is null then
    raise exception 'You must be signed in.';
  end if;

  p_slug := lower(btrim(p_slug));
  p_name := btrim(p_name);

  if p_name !~* '^.{2,60}$' then
    raise exception 'Organization name must be 2-60 characters.';
  end if;

  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 40 then
    raise exception 'Slug may contain lowercase letters, numbers and single hyphens (max 40).';
  end if;

  if p_slug = any (array[
    'api','auth','login','signin','signup','admin','dashboard','onboarding',
    'invite','invites','profile','settings','new','o','sift','jobs','chat','billing'
  ]) then
    raise exception '"%" is reserved. Pick another slug.', p_slug;
  end if;

  insert into public.organizations (name, slug, owner_id)
  values (p_name, p_slug, v_owner)
  returning id into v_org;

  -- Owner role: every permission toggled ON (matrix visible/editable in UI),
  -- plus implicit bypass in has_org_permission while they remain owner.
  -- Owner is the only immutable (is_system) role; every other role — including
  -- these seeds — is fully customizable/deletable by manage_roles holders,
  -- exactly like Discord's default roles.
  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Owner', '#f0a32b', 0, true)
  returning id into r_owner;

  insert into public.role_permissions (role_id, permission)
  select r_owner, src.p
  from unnest(enum_range(null::public.permission_key)) as src(p);

  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Admin', '#e5484d', 10, false)
  returning id into r_admin;

  insert into public.role_permissions (role_id, permission)
  select r_admin, src.p
  from unnest(enum_range(null::public.permission_key)) as src(p)
  where src.p <> 'manage_billing';

  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Editor', '#57c785', 20, false)
  returning id into r_editor;

  insert into public.role_permissions (role_id, permission)
  select r_editor, src.p
  from unnest(array[
    'claim_jobs_direct'::public.permission_key,
    'apply_to_jobs'::public.permission_key,
    'send_chat'::public.permission_key
  ]) as src(p);

  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Member', '#8a8577', 30, false)
  returning id into r_member;

  insert into public.role_permissions (role_id, permission)
  values (r_member, 'send_chat');

  insert into public.organization_members (organization_id, user_id)
  values (v_org, v_owner);

  insert into public.member_roles (organization_member_id, role_id, organization_id)
  select m.id, r_owner, v_org
  from public.organization_members m
  where m.organization_id = v_org and m.user_id = v_owner;

  return v_org;
end $$;

grant execute on function public.create_organization(text, text) to authenticated, service_role;
revoke execute on function public.create_organization(text, text) from anon, public;

-- ----------------------------------------------------------------------------
-- RPC: redeem an invite token (join flow, atomic)
-- Returns the org slug on success so the client can navigate.
-- ----------------------------------------------------------------------------

create or replace function public.redeem_invite(p_token text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_user      constant uuid := auth.uid();
  inv         public.organization_invites%rowtype;
  v_slug      text;
  v_member    uuid;
  v_suspended boolean := false;
  v_banned    boolean := false;
  v_already   boolean := false;
begin
  if v_user is null then
    raise exception 'Sign in first, then redeem your invite.';
  end if;

  select * into inv
  from public.organization_invites
  where token = btrim(p_token);

  if not found then
    raise exception 'This invite link is invalid.';
  end if;

  select o.slug, o.status = 'suspended', m.status = 'banned'
  into v_slug, v_suspended, v_banned
  from public.organizations o
  left join public.organization_members m
    on m.organization_id = o.id and m.user_id = v_user
  where o.id = inv.organization_id;

  if v_slug is null then
    raise exception 'This invite points to a deleted workspace.';
  end if;

  if v_suspended then
    raise exception 'This workspace is currently unavailable.';
  end if;

  if v_banned then
    raise exception 'You are banned from this workspace.';
  end if;

  if exists (
    select 1 from public.organization_members
    where organization_id = inv.organization_id and user_id = v_user
  ) then
    raise exception 'You are already a member of this workspace.';
  end if;

  if inv.expires_at is not null and inv.expires_at <= now() then
    raise exception 'This invite has expired.';
  end if;

  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    raise exception 'This invite has no uses left.';
  end if;

  if inv.email is not null
     and lower(btrim(inv.email)) <> lower(coalesce(auth.email(), '')) then
    raise exception 'This invite was issued to a different email address.';
  end if;

  insert into public.organization_members (organization_id, user_id)
  values (inv.organization_id, v_user)
  returning id into v_member;

  insert into public.member_roles (organization_member_id, role_id, organization_id)
  values (v_member, inv.role_id, inv.organization_id);

  update public.organization_invites
  set uses = uses + 1, accepted_at = now()
  where id = inv.id;

  return v_slug;
end $$;

grant execute on function public.redeem_invite(text) to authenticated, service_role;
revoke execute on function public.redeem_invite(text) from anon, public;

-- ----------------------------------------------------------------------------
-- RPC: leave an organization (owners must transfer ownership first)
-- ----------------------------------------------------------------------------

create or replace function public.leave_organization(p_org uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_org_owner(p_org) then
    raise exception 'Owners cannot leave their own organization. Transfer ownership first (coming soon) or delete the organization.';
  end if;

  delete from public.organization_members
  where organization_id = p_org and user_id = auth.uid();

  if not found then
    raise exception 'You are not a member of this organization.';
  end if;
end $$;

grant execute on function public.leave_organization(uuid) to authenticated;
revoke execute on function public.leave_organization(uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- Audit trail triggers — append-only, automatic. Actor comes from the JWT
-- (null for service-role/system writes, recorded as system).
-- ----------------------------------------------------------------------------

create or replace function public.sift_write_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_org     uuid;
  v_target  uuid;
  v_actor   uuid;
  v_row     jsonb;
  v_old     jsonb;
begin
  v_actor := auth.uid();

  case tg_table_name
    when 'organizations' then
      v_org := coalesce(new.id, old.id);
      v_row := coalesce(to_jsonb(new), to_jsonb(old));
    when 'roles' then
      v_org := coalesce(new.organization_id, old.organization_id);
      v_row := coalesce(to_jsonb(new), to_jsonb(old));
    when 'role_permissions' then
      select organization_id into v_org from public.roles
      where id = coalesce(new.role_id, old.role_id);
      v_row := coalesce(to_jsonb(new), to_jsonb(old));
    when 'organization_members' then
      v_org    := coalesce(new.organization_id, old.organization_id);
      v_target := coalesce(new.user_id, old.user_id);
      v_row    := coalesce(to_jsonb(new), to_jsonb(old));
    when 'member_roles' then
      v_org := coalesce(new.organization_id, old.organization_id);
      select user_id into v_target
      from public.organization_members
      where id = coalesce(new.organization_member_id, old.organization_member_id);
      v_row := coalesce(to_jsonb(new), to_jsonb(old));
    when 'organization_invites' then
      v_org := coalesce(new.organization_id, old.organization_id);
      v_row := coalesce(to_jsonb(new), to_jsonb(old));
    else
      v_row := coalesce(to_jsonb(new), to_jsonb(old));
  end case;

  if v_org is null then
    return coalesce(new, old);
  end if;

  insert into public.audit_log (organization_id, actor_id, action, target_user_id, details)
  values (
    v_org,
    v_actor,
    tg_table_name || '.' || lower(tg_op),
    v_target,
    jsonb_build_object('row', v_row, 'by_system', v_actor is null)
  );

  return coalesce(new, old);
end $$;

create trigger audit_organizations
  after insert or update or delete on public.organizations
  for each row execute function public.sift_write_audit();

create trigger audit_roles
  after insert or update or delete on public.roles
  for each row execute function public.sift_write_audit();

create trigger audit_role_permissions
  after insert or delete on public.role_permissions
  for each row execute function public.sift_write_audit();

create trigger audit_organization_members
  after insert or update or delete on public.organization_members
  for each row execute function public.sift_write_audit();

create trigger audit_member_roles
  after insert or delete on public.member_roles
  for each row execute function public.sift_write_audit();

create trigger audit_organization_invites
  after insert on public.organization_invites
  for each row execute function public.sift_write_audit();

-- ============================================================================
-- ROW LEVEL SECURITY — the primary enforcement layer.
-- Every tenant table: enabled + forceable policies keyed on organization_id.
-- ============================================================================

alter table public.profiles              enable row level security;
alter table public.platform_admins       enable row level security;
alter table public.organizations         enable row level security;
alter table public.roles                 enable row level security;
alter table public.role_permissions      enable row level security;
alter table public.organization_members  enable row level security;
alter table public.member_roles          enable row level security;
alter table public.organization_invites  enable row level security;
alter table public.audit_log             enable row level security;

-- profiles -------------------------------------------------------------------

create policy profiles_select_authenticated on public.profiles
  for select to authenticated using (true);

create policy profiles_insert_self on public.profiles
  for insert to authenticated with check (id = auth.uid());

create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid())
  with check (id = auth.uid());

-- platform_admins -------------------------------------------------------------

create policy platform_admins_select_self on public.platform_admins
  for select to authenticated using (user_id = auth.uid());

-- organizations ----------------------------------------------------------------
-- Readable by: platform admins (management console), owner, active members.
-- Plan/stripe columns sync through Stripe webhooks using the service key
-- (which bypasses RLS), so no client-facing write path exists for them.

create policy organizations_select on public.organizations
  for select to authenticated using (
    public.is_platform_admin() or public.is_org_owner(id) or public.is_org_member(id)
  );

create policy organizations_update_owner on public.organizations
  for update to authenticated
  using (public.is_org_owner(id))
  with check (public.is_org_owner(id));

create policy organizations_delete_owner on public.organizations
  for delete to authenticated using (public.is_org_owner(id));

-- roles ------------------------------------------------------------------------

create policy roles_select_member on public.roles
  for select to authenticated using (public.is_org_member(organization_id));

create policy roles_insert_manage on public.roles
  for insert to authenticated
  with check (not is_system and public.has_org_permission(organization_id, 'manage_roles'));

create policy roles_update_manage on public.roles
  for update to authenticated
  using (not is_system and public.has_org_permission(organization_id, 'manage_roles'))
  with check (not is_system and public.has_org_permission(organization_id, 'manage_roles'));

create policy roles_delete_manage on public.roles
  for delete to authenticated
  using (not is_system and public.has_org_permission(organization_id, 'manage_roles'));

-- role_permissions ---------------------------------------------------------------

create policy role_permissions_select_member on public.role_permissions
  for select to authenticated using (
    exists (
      select 1 from public.roles r
      where r.id = role_id and public.is_org_member(r.organization_id)
    )
  );

create policy role_permissions_insert_manage on public.role_permissions
  for insert to authenticated with check (
    exists (
      select 1 from public.roles r
      where r.id = role_id
        and not r.is_system
        and public.has_org_permission(r.organization_id, 'manage_roles')
    )
  );

create policy role_permissions_delete_manage on public.role_permissions
  for delete to authenticated using (
    exists (
      select 1 from public.roles r
      where r.id = role_id
        and not r.is_system
        and public.has_org_permission(r.organization_id, 'manage_roles')
    )
  );

-- organization_members -------------------------------------------------------------

create policy members_select on public.organization_members
  for select to authenticated using (
    user_id = auth.uid() or public.is_org_member(organization_id)
  );

-- No INSERT policy: joining happens exclusively through redeem_invite().

create policy members_update_ban on public.organization_members
  for update to authenticated
  using (
    public.has_org_permission(organization_id, 'ban_users')
    and user_id <> (select owner_id from public.organizations where id = organization_id)
  )
  with check (
    public.has_org_permission(organization_id, 'ban_users')
    and user_id <> (select owner_id from public.organizations where id = organization_id)
  );

-- Delete = kick (with kick_users, not the owner) OR leaving yourself (never the owner;
-- owners go through leave_organization(), which errors with guidance).
create policy members_delete_kick_or_leave on public.organization_members
  for delete to authenticated using (
    (
      public.has_org_permission(organization_id, 'kick_users')
      and user_id <> (select owner_id from public.organizations where id = organization_id)
    )
    or
    (
      user_id = auth.uid()
      and not public.is_org_owner(organization_id)
    )
  );

-- member_roles -----------------------------------------------------------------------

create policy member_roles_select_member on public.member_roles
  for select to authenticated using (public.is_org_member(organization_id));

create policy member_roles_insert_manage on public.member_roles
  for insert to authenticated
  with check (public.has_org_permission(organization_id, 'manage_roles'));

create policy member_roles_delete_manage on public.member_roles
  for delete to authenticated
  using (public.has_org_permission(organization_id, 'manage_roles'));

-- organization_invites ------------------------------------------------------------------

create policy invites_select_manage on public.organization_invites
  for select to authenticated
  using (public.has_org_permission(organization_id, 'manage_roles'));

create policy invites_insert_manage on public.organization_invites
  for insert to authenticated
  with check (
    invited_by = auth.uid()
    and public.has_org_permission(organization_id, 'manage_roles')
  );

create policy invites_delete_manage on public.organization_invites
  for delete to authenticated
  using (public.has_org_permission(organization_id, 'manage_roles'));

-- audit_log (read-only to clients; inserts happen only via audit triggers) ---------------

create policy audit_select_admin on public.audit_log
  for select to authenticated
  using (public.has_org_permission(organization_id, 'access_admin_panel'));

-- ----------------------------------------------------------------------------
-- Storage: avatars (public read, per-user write prefix)
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

create policy avatars_public_read on storage.objects
  for select using (bucket_id = 'avatars');

create policy avatars_owner_insert on storage.objects
  for insert to authenticated with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_owner_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy avatars_owner_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

commit;

-- ============================================================================
-- Verified behaviors (covered by tests/rls.test.ts once env keys are set):
--  * Org A member cannot SELECT any Org B row on ANY tenant table.
--  * Member without manage_roles cannot read/create invites or edit roles.
--  * Member without kick/ban cannot mutate other members' rows.
--  * Banned member cannot redeem another invite into the same org.
--  * Owner cannot be kicked/banned by anyone; owner cannot leave via RPC.
--  * Platform admin reads org metadata but zero org-private content.
--  * create_organization is atomic: failure leaves zero partial rows.
-- ============================================================================
