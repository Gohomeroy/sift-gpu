-- ============================================================================
-- SIFT — Migration 0032: per-clip deletion
--
-- delete_clip() removes ONE clip the same safe way delete_clip_job() removes
-- a whole job: its storage object and its row (cascading clip_posts + clip
-- memory) go together. There is no client-side clips DELETE policy, so this
-- must run through a security-definer RPC. Clips may be deleted by the org
-- owner or by the creator of the job that produced the clip.
-- ============================================================================

begin;

create or replace function public.delete_clip(p_clip uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me      uuid := auth.uid();
  v_job     uuid;
  v_org     uuid;
  v_owner   uuid;
  v_storage text;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  select c.storage_path, c.job_id, j.organization_id, o.owner_id
    into v_storage, v_job, v_org, v_owner
  from public.clips c
  join public.clip_jobs j on j.id = c.job_id
  join public.organizations o on o.id = j.organization_id
  where c.id = p_clip;

  if v_org is null then
    raise exception 'Clip not found.';
  end if;

  if not public.is_org_member(v_org) then
    raise exception 'You are not a member of this workspace.';
  end if;

  if v_me <> v_owner and not exists (
    select 1 from public.clip_jobs where id = v_job and created_by = v_me
  ) then
    raise exception 'You can only delete your own clips.';
  end if;

  if v_storage is not null and v_storage <> '' then
    delete from storage.objects
    where bucket_id = 'clips' and name = v_storage;
  end if;

  delete from public.clips where id = p_clip;
end $$;

grant execute on function public.delete_clip(uuid) to authenticated;
revoke execute on function public.delete_clip(uuid) from anon, public;

commit;