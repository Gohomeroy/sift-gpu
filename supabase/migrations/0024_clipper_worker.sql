-- ============================================================================
-- SIFT — Migration 0024: AI Clipper worker telemetry & rich clips
--
-- Workers report lifecycle stage + progress percent so the UI can show a
-- real stepper. Clips gain the fields the pipeline produces (social caption,
-- hashtags, VL reasoning, which engine made them).
-- ============================================================================

begin;

alter table public.clip_jobs
  add column if not exists provider text not null default 'local'
    check (provider in ('local', 'reka')),
  add column if not exists stage text not null default 'queued',
  add column if not exists progress int not null default 0,
  add column if not exists caption_style text not null default 'hormozi'
    check (caption_style in ('hormozi','beast','karaoke','boxed','minimal'));

-- Stage vocabulary mirrors the worker pipeline:
-- queued · downloading · transcribing · segmenting · scoring · watching ·
-- cutting · rendering · completed · failed
comment on column public.clip_jobs.stage is
  'Current pipeline stage reported by the worker.';
comment on column public.clip_jobs.progress is
  'Coarse completion percentage (0-100) for progress bars.';

alter table public.clips
  add column if not exists caption text,
  add column if not exists hashtags jsonb not null default '[]'::jsonb,
  add column if not exists reasoning text,
  add column if not exists provider text not null default 'local';

-- create_clip_job gains an optional caption style (defaults keep the old
-- two-arg call sites valid).
create or replace function public.create_clip_job(
  p_org uuid,
  p_source_url text,
  p_title text,
  p_caption_style text default 'hormozi'
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

  if p_caption_style not in ('hormozi','beast','karaoke','boxed','minimal') then
    p_caption_style := 'hormozi';
  end if;

  insert into public.clip_jobs (organization_id, created_by, source_url, title, caption_style)
  values (p_org, v_me, btrim(p_source_url), btrim(p_title), p_caption_style)
  returning id into v_id;

  return v_id;
end $$;

commit;
