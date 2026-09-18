-- ============================================================================
-- SIFT — Migration 0033: storage-safe clip deletion
--
-- Supabase now blocks raw `delete from storage.objects` (protection trigger
-- 0055): object rows may only be removed through the Storage API, which is the
-- only path that sets the allow_delete_query flag AND cleans up the backing
-- file. So delete_clip() no longer deletes storage rows itself. The server
-- action deletes the clip file via the Storage API first (supabase-js
-- storage.remove), then calls this RPC purely to drop the public.clips row
-- (and its cascade), preserving the membership + ownership checks.
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
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  select c.job_id, j.organization_id, o.owner_id
    into v_job, v_org, v_owner
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

  delete from public.clips where id = p_clip;
end $$;

grant execute on function public.delete_clip(uuid) to authenticated;
revoke execute on function public.delete_clip(uuid) from anon, public;

commit;