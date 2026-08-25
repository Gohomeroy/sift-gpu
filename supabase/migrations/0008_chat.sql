-- ============================================================================
-- SIFT — Migration 0008: Chat (stage 4)
--
-- Discord-style per-org community: text channels + messages. Every active
-- member can read; posting is gated by send_chat; moderation (channel
-- management, deleting anyone's messages) by moderate_chat. Authors always
-- control their own messages (edit marks edited_at, shown as "edited").
--
-- New orgs get a #general channel seeded by create_organization (re-created
-- here); existing orgs are backfilled below.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- Channels
-- ----------------------------------------------------------------------------

create table public.chat_channels (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  name            text not null check (char_length(btrim(name)) between 1 and 40),
  slug            text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 40),
  topic           text check (char_length(topic) <= 200),
  created_by      uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (organization_id, slug)
);

create index chat_channels_org_idx on public.chat_channels (organization_id);

-- ----------------------------------------------------------------------------
-- Messages
-- ----------------------------------------------------------------------------

create table public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  channel_id      uuid not null references public.chat_channels (id) on delete cascade,
  organization_id uuid not null,
  author_id       uuid not null references auth.users (id) on delete cascade,
  body            text not null check (char_length(btrim(body)) between 1 and 2000),
  edited_at       timestamptz,
  created_at      timestamptz not null default now()
);

create index chat_messages_channel_idx on public.chat_messages (channel_id, created_at);
create index chat_messages_org_idx on public.chat_messages (organization_id);

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.chat_channels enable row level security;
alter table public.chat_messages enable row level security;

-- Reading is membership, plain and simple.
create policy channels_select_member on public.chat_channels
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy messages_select_member on public.chat_messages
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Channel management is moderate_chat; creators stamp themselves.
create policy channels_insert_moderate on public.chat_channels
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_org_permission(organization_id, 'moderate_chat')
  );

create policy channels_update_moderate on public.chat_channels
  for update to authenticated
  using (public.has_org_permission(organization_id, 'moderate_chat'))
  with check (public.has_org_permission(organization_id, 'moderate_chat'));

create policy channels_delete_moderate on public.chat_channels
  for delete to authenticated
  using (public.has_org_permission(organization_id, 'moderate_chat'));

-- Posting needs send_chat; authors may edit/delete their own messages,
-- moderate_chat holders may delete anyone's.
create policy messages_insert_send on public.chat_messages
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and public.has_org_permission(organization_id, 'send_chat')
  );

create policy messages_update_author on public.chat_messages
  for update to authenticated
  using (author_id = auth.uid())
  with check (author_id = auth.uid());

create policy messages_delete_own_or_moderate on public.chat_messages
  for delete to authenticated
  using (
    author_id = auth.uid()
    or public.has_org_permission(organization_id, 'moderate_chat')
  );

-- ----------------------------------------------------------------------------
-- Seed #general for every org that has no channels yet (existing orgs).
-- ----------------------------------------------------------------------------

insert into public.chat_channels (organization_id, name, slug, created_by)
select o.id, 'general', 'general', o.owner_id
from public.organizations o
where o.status = 'active'
  and not exists (
    select 1 from public.chat_channels c where c.organization_id = o.id
  );

-- ----------------------------------------------------------------------------
-- create_organization: seed #general for new orgs (replaces 0003's version —
-- identical except for the final channel insert).
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

  insert into public.chat_channels (organization_id, name, slug, created_by)
  values (v_org, 'general', 'general', v_owner);

  return v_org;
end $$;

commit;
