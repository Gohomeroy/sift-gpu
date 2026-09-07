-- ============================================================================
-- SIFT — Migration 0031: content_type (auto | podcast | streamer)
--
-- The Clip Wizard now lets you tell the AI what kind of footage you dropped
-- in:
--   auto     → let the worker pick the best pipeline (default)
--   podcast  → legacy hook → question → payoff arc discovery
--   streamer → event-driven Qwen3-VL moment discovery (Twitch/YouTube/Kick
--              streams, IRL, vlogs) — no arc building, deep multimodal
--              analysis of detected events instead
--
-- clip_jobs gains a content_type column and create_clip_job accepts it.
-- Historical overloads are dropped (same every-paramature-pattern as 0029).
-- ============================================================================

begin;

-- 1) clip_jobs: new column + whitelist.
alter table public.clip_jobs
  add column if not exists content_type text not null default 'auto',
  add constraint clip_jobs_content_type_check check (
    content_type in ('auto', 'podcast', 'streamer')
  );

-- 2) create_clip_job — new p_content_type param with a safe default.
--
-- Drop EVERY historical overload so the function name resolves
-- unambiguously to the new signature.
drop function if exists public.create_clip_job(uuid, text, text);
drop function if exists public.create_clip_job(uuid, text, text, text);
drop function if exists public.create_clip_job(uuid, text, text, text, int);
drop function if exists public.create_clip_job(uuid, text, text, text, text, text, text, int);
drop function if exists public.create_clip_job(uuid, text, text, text, text, text, text, text, int);

create or replace function public.create_clip_job(
  p_org uuid,
  p_source_url text,
  p_title text,
  p_content_type text default 'auto',
  p_caption_style text default 'pop',
  p_caption_font text default 'anton',
  p_caption_sub text default 'zoom',
  p_caption_theme text default 'pop',
  p_reframe_style text default 'track',
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
     and v_me <> 'bbca7565-4d7f-48b9-948b-0fca51f7346d'
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

  if p_content_type not in ('auto', 'podcast', 'streamer') then
    p_content_type := 'auto';
  end if;
  if p_caption_style not in ('karaoke','pill','boxed','minimal','two_tone','pop') then
    p_caption_style := 'pop';
  end if;
  if p_caption_font not in ('impact','anton','outfit','poppins','montserrat','rajdhani') then
    p_caption_font := 'anton';
  end if;
  if p_caption_sub not in ('plain','bounce','fade','zoom','wave','rotate') then
    p_caption_sub := 'zoom';
  end if;
  if p_caption_theme not in ('pop','karaoke','hustle','grape','beast','poppin') then
    p_caption_theme := 'pop';
  end if;
  if p_reframe_style not in ('track', 'blur') then
    p_reframe_style := 'track';
  end if;

  -- Clamp clip_count to 1-10.
  if p_clip_count is null or p_clip_count < 1 then
    p_clip_count := 3;
  end if;
  p_clip_count := greatest(1, least(10, p_clip_count));

  insert into public.clip_jobs (
    organization_id, created_by, source_url, title,
    content_type, caption_style, caption_font, caption_sub, caption_theme, reframe_style, clip_count
  )
  values (
    p_org, v_me, btrim(p_source_url), btrim(p_title),
    p_content_type, p_caption_style, p_caption_font, p_caption_sub, p_caption_theme, p_reframe_style, p_clip_count
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.create_clip_job(uuid, text, text, text, text, text, text, text, text, int) to authenticated;
revoke execute on function public.create_clip_job(uuid, text, text, text, text, text, text, text, text, int) from anon, public;

commit;