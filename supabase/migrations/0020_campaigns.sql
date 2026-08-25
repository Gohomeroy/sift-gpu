-- ============================================================================
-- SIFT — Migration 0020: Clipping & UGC campaigns (Phase D)
--
-- Whop-style campaigns: members with manage_campaigns post campaigns (title,
-- brief, reward text, optional banner — a SIFT default banner renders when
-- absent). Any active member submits entries (clip links with platform +
-- view counts); manage_campaigns holders approve or reject them.
-- ============================================================================

-- Grant to Owner + Admin roles of every existing org (new orgs get it via
-- the updated create_organization below; Owner also gets it implicitly via
-- the bypass).
insert into public.role_permissions (role_id, permission)
select r.id, 'manage_campaigns'::public.permission_key
from public.roles r
where r.name in ('Owner', 'Admin')
on conflict (role_id, permission) do nothing;

begin;

create table public.campaigns (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title           text not null check (char_length(btrim(title)) between 3 and 80),
  brief           text not null check (char_length(btrim(brief)) between 10 and 2000),
  reward_text     text check (char_length(reward_text) <= 120),
  banner_path     text,
  status          text not null default 'open' check (status in ('open', 'closed')),
  created_by      uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now()
);

create index campaigns_org_idx on public.campaigns (organization_id);

create table public.campaign_entries (
  id              uuid primary key default gen_random_uuid(),
  campaign_id     uuid not null references public.campaigns (id) on delete cascade,
  organization_id uuid not null,
  submitted_by    uuid not null references auth.users (id) on delete cascade,
  platform        text not null check (platform in ('tiktok', 'youtube', 'instagram', 'other')),
  url             text not null check (char_length(url) between 10 and 500),
  views           int not null default 0 check (views >= 0),
  note            text check (char_length(note) <= 500),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at      timestamptz not null default now()
);

create index campaign_entries_campaign_idx on public.campaign_entries (campaign_id, created_at);

alter table public.campaigns enable row level security;
alter table public.campaign_entries enable row level security;

create policy campaigns_select_member on public.campaigns
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy campaigns_insert_manager on public.campaigns
  for insert to authenticated
  with check (
    created_by = auth.uid()
    and public.has_org_permission(organization_id, 'manage_campaigns')
  );

create policy campaigns_update_manager on public.campaigns
  for update to authenticated
  using (public.has_org_permission(organization_id, 'manage_campaigns'))
  with check (public.has_org_permission(organization_id, 'manage_campaigns'));

create policy campaigns_delete_manager on public.campaigns
  for delete to authenticated
  using (public.has_org_permission(organization_id, 'manage_campaigns'));

create policy entries_select_member on public.campaign_entries
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy entries_insert_member on public.campaign_entries
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and public.is_org_member(organization_id)
    and exists (
      select 1 from public.campaigns c
      where c.id = campaign_id
        and c.organization_id = organization_id
        and c.status = 'open'
    )
  );

-- Submitters may edit their own entry while it is still pending.
create policy entries_update_pending on public.campaign_entries
  for update to authenticated
  using (
    submitted_by = auth.uid()
    and status = 'pending'
  )
  with check (
    submitted_by = auth.uid()
    and status = 'pending'
  );

-- Campaign managers decide outcomes; submitters may withdraw.
create policy entries_update_manager on public.campaign_entries
  for update to authenticated
  using (
    public.has_org_permission(organization_id, 'manage_campaigns')
    or submitted_by = auth.uid()
  )
  with check (
    public.has_org_permission(organization_id, 'manage_campaigns')
    or submitted_by = auth.uid()
  );

create policy entries_delete_own_or_manager on public.campaign_entries
  for delete to authenticated
  using (
    submitted_by = auth.uid()
    or public.has_org_permission(organization_id, 'manage_campaigns')
  );

-- ----------------------------------------------------------------------------
-- Campaign banners: public read, manage_campaigns-gated write.
-- Path contract: <org_id>/<uuid>.<ext>
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('campaign-banners', 'campaign-banners', true)
on conflict (id) do nothing;

create policy campaign_banners_public_read on storage.objects
  for select using (bucket_id = 'campaign-banners');

create policy campaign_banners_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'campaign-banners'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'manage_campaigns')
  );

create policy campaign_banners_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'campaign-banners'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'manage_campaigns')
  );

commit;

-- ----------------------------------------------------------------------------
-- create_organization: seed manage_campaigns onto Owner + Admin (replaces the
-- 0008 version — identical except the two permission seed lists).
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
