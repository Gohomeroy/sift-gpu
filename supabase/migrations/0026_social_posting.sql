-- ============================================================================
-- SIFT — Migration 0026: Social posting pipeline
--
-- Adds OAuth token storage for connected social accounts and a posts table
-- to track clip submissions across TikTok, YouTube, Instagram.
-- ============================================================================

begin;

-- ── OAuth tokens for linked accounts ────────────────────────────────────
-- Stores access/refresh tokens so the worker can post on behalf of users.
alter table public.linked_accounts
  add column if not exists oauth_access_token text,
  add column if not exists oauth_refresh_token text,
  add column if not exists oauth_expires_at timestamptz,
  add column if not exists oauth_scopes text[] default '{}';

comment on column public.linked_accounts.oauth_access_token is
  'OAuth access token for API posting (TikTok, YouTube, Instagram).';
comment on column public.linked_accounts.oauth_refresh_token is
  'OAuth refresh token for obtaining new access tokens.';

-- ── Posts table — tracks every clip posted to a social platform ─────────
create table if not exists public.clip_posts (
  id          uuid primary key default gen_random_uuid(),
  clip_id     uuid not null references public.clips(id) on delete cascade,
  account_id  uuid not null references public.linked_accounts(id) on delete cascade,
  job_id      uuid not null references public.clip_jobs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  platform    text not null check (platform in ('tiktok', 'youtube', 'instagram', 'other')),
  status      text not null default 'queued'
                check (status in ('queued', 'posting', 'posted', 'failed', 'cancelled')),

  caption     text,
  hashtags    jsonb default '[]'::jsonb,
  platform_post_id text,  -- ID returned by the platform API
  platform_url text,     -- URL of the published post
  error       text,

  posted_at   timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.clip_posts is
  'Tracks clip submissions to social platforms (TikTok, YouTube, Instagram).';

-- Indexes
create index if not exists idx_clip_posts_clip_id on public.clip_posts(clip_id);
create index if not exists idx_clip_posts_account_id on public.clip_posts(account_id);
create index if not exists idx_clip_posts_job_id on public.clip_posts(job_id);
create index if not exists idx_clip_posts_org_id on public.clip_posts(organization_id);
create index if not exists idx_clip_posts_status on public.clip_posts(status);

-- ── RLS policies ────────────────────────────────────────────────────────
alter table public.clip_posts enable row level security;

-- Members can view posts for their org.
create policy "clip_posts_select_org" on public.clip_posts
  for select using (public.is_org_member(organization_id));

-- Members can create posts for their org (if they own the clip).
create policy "clip_posts_insert_org" on public.clip_posts
  for insert with check (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.clips c
      where c.id = clip_id and c.organization_id = clip_posts.organization_id
    )
  );

-- Members can update their own org's posts (for status changes).
create policy "clip_posts_update_org" on public.clip_posts
  for update using (public.is_org_member(organization_id));

-- Members can delete posts for their org.
create policy "clip_posts_delete_org" on public.clip_posts
  for delete using (public.is_org_member(organization_id));

-- ── RPC: create a post job ──────────────────────────────────────────────
create or replace function public.create_clip_post(
  p_clip_id uuid,
  p_account_id uuid,
  p_caption text default null,
  p_hashtags jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_clip  record;
  v_post  uuid;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  -- Fetch clip + verify ownership.
  select c.id, c.job_id, c.organization_id, c.storage_path
  into v_clip
  from public.clips c
  where c.id = p_clip_id;

  if v_clip is null then
    raise exception 'Clip not found.';
  end if;

  if not public.is_org_member(v_clip.organization_id) then
    raise exception 'You are not a member of this workspace.';
  end if;

  -- Verify the linked account belongs to the user.
  if not exists (
    select 1 from public.linked_accounts la
    where la.id = p_account_id and la.user_id = v_me
  ) then
    raise exception 'This linked account does not belong to you.';
  end if;

  -- Prevent duplicate posts for the same clip + account.
  if exists (
    select 1 from public.clip_posts cp
    where cp.clip_id = p_clip_id
      and cp.account_id = p_account_id
      and cp.status in ('queued', 'posting')
  ) then
    raise exception 'This clip is already queued/posting to this account.';
  end if;

  insert into public.clip_posts (clip_id, account_id, job_id, organization_id, platform, caption, hashtags)
  select
    p_clip_id,
    p_account_id,
    v_clip.job_id,
    v_clip.organization_id,
    la.platform,
    p_caption,
    p_hashtags
  from public.linked_accounts la
  where la.id = p_account_id
  returning id into v_post;

  return v_post;
end $$;

-- ── RPC: update post status (worker only) ───────────────────────────────
create or replace function public.update_clip_post_status(
  p_post_id uuid,
  p_status text,
  p_platform_post_id text default null,
  p_platform_url text default null,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.clip_posts
  set
    status = p_status,
    platform_post_id = coalesce(p_platform_post_id, platform_post_id),
    platform_url = coalesce(p_platform_url, platform_url),
    error = coalesce(p_error, error),
    posted_at = case when p_status = 'posted' then now() else posted_at end,
    updated_at = now()
  where id = p_post_id;
end $$;

commit;
