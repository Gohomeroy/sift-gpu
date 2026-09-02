-- ============================================================================
-- SIFT — Migration 0025: clip_count option + VL discovery support
--
-- Lets users choose how many clips they want per job (1-10, default 3).
-- Worker reads clip_count and produces that many ranked clips.
-- ============================================================================

begin;

alter table public.clip_jobs
  add column if not exists clip_count int not null default 3;

alter table public.clip_jobs
  add constraint clip_count_range check (clip_count between 1 and 10);

comment on column public.clip_jobs.clip_count is
  'Number of clips the user wants from this job (1-10, default 3).';

-- create_clip_job gains an optional clip_count param (backward-compatible).
create or replace function public.create_clip_job(
  p_org uuid,
  p_source_url text,
  p_title text,
  p_caption_style text default 'hormozi',
  p_clip_count int default 3
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

  -- Clamp clip_count to 1-10.
  if p_clip_count is null or p_clip_count < 1 then
    p_clip_count := 3;
  end if;
  p_clip_count := greatest(1, least(10, p_clip_count));

  insert into public.clip_jobs (organization_id, created_by, source_url, title, caption_style, clip_count)
  values (p_org, v_me, btrim(p_source_url), btrim(p_title), p_caption_style, p_clip_count)
  returning id into v_id;

  return v_id;
end $$;

commit;
