-- ============================================================================
-- SIFT — Migration 0034: storage-safe clip_job deletion
--
-- Companion to 0033. delete_clip_job() likewise stops deleting storage rows
-- directly (the protection trigger blocks raw DELETE on storage.objects; only
-- the Storage API may remove object rows + their backing files). The server
-- action removes all of the job's files via the Storage API first, then this
-- RPC drops the clips + job rows, keeping the membership + ownership checks.
-- ============================================================================

begin;

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

  delete from public.clips where job_id = p_job;
  delete from public.clip_jobs where id = p_job;
end $$;

grant execute on function public.delete_clip_job(uuid) to authenticated;
revoke execute on function public.delete_clip_job(uuid) from anon, public;

commit;