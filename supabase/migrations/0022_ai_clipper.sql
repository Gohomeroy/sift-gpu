-- ============================================================================
-- SIFT — Migration 0022: AI Clipper (Phase E — product shell)
--
-- Long-form links go in as clip_jobs (queued); an external worker (separate
-- server, service role) picks them up, runs highlight detection + clip
-- cutting + caption rendering with open-source models, uploads rendered
-- clips to the private `clips` bucket and inserts clip rows.
--
-- Paywall hook: free-plan orgs are capped at 3 jobs total; pro/studio are
-- uncapped. When Stripe lands, the cap logic is already plan-driven.
-- ============================================================================

begin;

create table public.clip_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  created_by      uuid not null references auth.users (id) on delete cascade,
  source_url      text not null check (source_url ~ '^https?://'),
  title           text not null check (char_length(btrim(title)) between 3 and 120),
  status          text not null default 'queued'
                  check (status in ('queued', 'processing', 'completed', 'failed')),
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index clip_jobs_org_idx on public.clip_jobs (organization_id, created_at desc);

create trigger clip_jobs_touch_updated
  before update on public.clip_jobs
  for each row execute function public.sift_touch_updated_at();

create table public.clips (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.clip_jobs (id) on delete cascade,
  organization_id uuid not null,
  title           text not null default '',
  start_seconds   numeric(10, 2),
  end_seconds     numeric(10, 2),
  viral_score     int check (viral_score between 0 and 100),
  caption_style   text,
  storage_path    text not null,
  created_at      timestamptz not null default now()
);

create index clips_job_idx on public.clips (job_id, created_at);

alter table public.clip_jobs enable row level security;
alter table public.clips enable row level security;

-- Org members see their workspace's jobs and clips. No client INSERT policy:
-- jobs are created exclusively through create_clip_job(), and clips are
-- written by the worker's service role.
create policy clip_jobs_select_member on public.clip_jobs
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy clip_jobs_delete_creator on public.clip_jobs
  for delete to authenticated
  using (created_by = auth.uid());

create policy clips_select_member on public.clips
  for select to authenticated
  using (public.is_org_member(organization_id));

-- ----------------------------------------------------------------------------
-- RPC: queue a clip job. Membership + plan cap enforced server-side.
-- ----------------------------------------------------------------------------

create or replace function public.create_clip_job(
  p_org uuid,
  p_source_url text,
  p_title text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_id   uuid;
  v_used int;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  if not public.is_org_member(p_org) then
    raise exception 'You are not a member of this workspace.';
  end if;

  select count(*) into v_used
  from public.clip_jobs where organization_id = p_org;

  if (select plan from public.organizations where id = p_org) = 'free'
     and v_used >= 3 then
    raise exception 'Free workspaces get 3 AI clipping videos — upgrade for unlimited (billing coming soon).';
  end if;

  if p_source_url !~ '^https?://.{8,}' then
    raise exception 'Paste the full https link to the long-form video.';
  end if;

  if btrim(p_title) = '' or char_length(btrim(p_title)) < 3
     or char_length(btrim(p_title)) > 120 then
    raise exception 'Give the job a title (3-120 characters).';
  end if;

  insert into public.clip_jobs (organization_id, created_by, source_url, title)
  values (p_org, v_me, btrim(p_source_url), btrim(p_title))
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.create_clip_job(uuid, text, text) to authenticated;
revoke execute on function public.create_clip_job(uuid, text, text) from anon, public;

-- ----------------------------------------------------------------------------
-- Storage: rendered clips, private, org-gated reads. Writes happen only via
-- the worker's service role (no client policies on purpose).
-- Path contract: <org_id>/<job_id>/<uuid>.mp4
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('clips', 'clips', false)
on conflict (id) do nothing;

create policy clips_select_member on storage.objects
  for select to authenticated
  using (
    bucket_id = 'clips'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

-- ----------------------------------------------------------------------------
-- Realtime for live job status.
-- ----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'clip_jobs'
  ) then
    alter publication supabase_realtime add table public.clip_jobs;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'clips'
  ) then
    alter publication supabase_realtime add table public.clips;
  end if;
end $$;

commit;
