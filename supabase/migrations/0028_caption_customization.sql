-- ============================================================================
-- SIFT — Migration 0028: full caption customisation
--
-- The Clip Wizard now lets you pick 4 independent caption dimensions:
--   style (KARAOKE/PILL/BOXED/MINIMAL/TWO TONE/POP)
--   font  (IMPACT/ANTON/OUTFIT/POPPINS/MONTSERRAT/RAJDHANI)
--   sub animation (PLAIN/BOUNCE/FADE/ZOOM/WAVE/ROTATE)
--   theme (POP/KARAOKE/HUSTLE/GRAPE/BEAST/POPPIN)
--
-- clip_jobs + clips gain caption_font/caption_sub/caption_theme columns and
-- create_clip_job accepts them (defaults keep every older call site valid).
-- The old 5-style constraint is replaced by the new 6-style set.
-- ============================================================================

begin;

-- 1) clip_jobs: new columns (drop old caption_style check, add new style set)
alter table public.clip_jobs drop constraint if exists clip_jobs_caption_style_check;

-- Map legacy styles to the new set before enforcing the new constraint.
update public.clip_jobs set caption_style = 'pop' where caption_style = 'hormozi';
update public.clip_jobs set caption_style = 'pop' where caption_style = 'beast';

alter table public.clip_jobs
  add column if not exists caption_font text not null default 'anton',
  add column if not exists caption_sub text not null default 'zoom',
  add column if not exists caption_theme text not null default 'pop',
  add constraint clip_jobs_caption_style_check check (
    caption_style in ('karaoke','pill','boxed','minimal','two_tone','pop')
  ),
  add constraint clip_jobs_caption_font_check check (
    caption_font in ('impact','anton','outfit','poppins','montserrat','rajdhani')
  ),
  add constraint clip_jobs_caption_sub_check check (
    caption_sub in ('plain','bounce','fade','zoom','wave','rotate')
  ),
  add constraint clip_jobs_caption_theme_check check (
    caption_theme in ('pop','karaoke','hustle','grape','beast','poppin')
  );

-- 2) clips: same columns so the gallery can show what each clip used
alter table public.clips drop constraint if exists clips_caption_style_check;

-- Map legacy styles to the new set before enforcing the new constraint.
update public.clips set caption_style = 'pop' where caption_style in ('hormozi', 'beast');

alter table public.clips
  add column if not exists caption_font text,
  add column if not exists caption_sub text,
  add column if not exists caption_theme text,
  add constraint clips_caption_style_check check (
    caption_style in ('karaoke','pill','boxed','minimal','two_tone','pop')
  );

-- 3) create_clip_job — preserves the Traxn Studios owner exemption from 0027,
--    replaces the style whitelist, and stores the new dimensions.
create or replace function public.create_clip_job(
  p_org uuid,
  p_source_url text,
  p_title text,
  p_caption_style text default 'pop',
  p_caption_font text default 'anton',
  p_caption_sub text default 'zoom',
  p_caption_theme text default 'pop',
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

  -- Clamp clip_count to 1-10.
  if p_clip_count is null or p_clip_count < 1 then
    p_clip_count := 3;
  end if;
  p_clip_count := greatest(1, least(10, p_clip_count));

  insert into public.clip_jobs (
    organization_id, created_by, source_url, title,
    caption_style, caption_font, caption_sub, caption_theme, clip_count
  )
  values (
    p_org, v_me, btrim(p_source_url), btrim(p_title),
    p_caption_style, p_caption_font, p_caption_sub, p_caption_theme, p_clip_count
  )
  returning id into v_id;

  return v_id;
end $$;

grant execute on function public.create_clip_job(uuid, text, text, text) to authenticated;
grant execute on function public.create_clip_job(uuid, text, text, text, text) to authenticated;
grant execute on function public.create_clip_job(uuid, text, text, text, text, text) to authenticated;
grant execute on function public.create_clip_job(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function public.create_clip_job(uuid, text, text, text, text, text, text, int) to authenticated;
revoke execute on function public.create_clip_job(uuid, text, text, text) from anon, public;
revoke execute on function public.create_clip_job(uuid, text, text, text, text) from anon, public;
revoke execute on function public.create_clip_job(uuid, text, text, text, text, text) from anon, public;
revoke execute on function public.create_clip_job(uuid, text, text, text, text, text, text) from anon, public;
revoke execute on function public.create_clip_job(uuid, text, text, text, text, text, text, int) from anon, public;

commit;