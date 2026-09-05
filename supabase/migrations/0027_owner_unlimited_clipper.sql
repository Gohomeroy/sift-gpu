-- ============================================================================
-- SIFT — Migration 0027: Traxn Studios owner unlimited + job cleanup RPC
--
-- 1) The Traxn Studios owner account is exempt from the free-tier 3-video
--    cap. Every other account keeps the existing cap: free orgs stop at 3
--    AI clipping videos, pro/studio are uncapped.
-- 2) delete_clip_job() removes a job the safe way: storage objects, clip
--    rows and the job row all go together. The old UI delete only removed
--    the job row, leaving orphaned clips + storage that got stuck forever
--    (there is no client-side clips/storage delete policy). Jobs may be
--    deleted by their creator or by the org owner.
-- ============================================================================

begin;

-- The Traxn Studios owner account (roy).
-- Exempt from the free tier cap so the company app is always usable.
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

grant execute on function public.create_clip_job(uuid, text, text) to authenticated;
grant execute on function public.create_clip_job(uuid, text, text, text) to authenticated;
grant execute on function public.create_clip_job(uuid, text, text, text, int) to authenticated;
revoke execute on function public.create_clip_job(uuid, text, text) from anon, public;
revoke execute on function public.create_clip_job(uuid, text, text, text) from anon, public;
revoke execute on function public.create_clip_job(uuid, text, text, text, int) from anon, public;

-- ----------------------------------------------------------------------------
-- RPC: full job deletion. Creator or org owner only.
-- ----------------------------------------------------------------------------
create or replace function public.delete_clip_job(p_job uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid;
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  select j.organization_id, o.owner_id into v_org, v_owner
  from public.clip_jobs j
  join public.organizations o on o.id = j.organization_id
  where j.id = p_job;

  if v_org is null then
    raise exception 'Job not found.';
  end if;

  if not public.is_org_member(v_org) then
    raise exception 'You are not a member of this workspace.';
  end if;

  if v_me <> v_owner and not exists (
    select 1 from public.clip_jobs where id = p_job and created_by = v_me
  ) then
    raise exception 'You can only delete your own jobs.';
  end if;

  delete from storage.objects
  where bucket_id = 'clips'
    and name like v_org::text || '/' || p_job::text || '/%';

  delete from public.clips where job_id = p_job;
  delete from public.clip_jobs where id = p_job;
end $$;

grant execute on function public.delete_clip_job(uuid) to authenticated;
revoke execute on function public.delete_clip_job(uuid) from anon, public;

commit;