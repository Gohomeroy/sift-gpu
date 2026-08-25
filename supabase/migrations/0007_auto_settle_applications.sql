-- ============================================================================
-- SIFT — Migration 0007: Auto-settle job applications on assignment
--
-- Assignment previously settled the application queue only in the app layer
-- (assignApplicantAction). Any other write path — RPCs, future clients,
-- support fixes — could assign a job and leave applications dangling in
-- 'pending'. The settle now happens in a trigger on the jobs row itself:
-- the assigned applicant's pending application is accepted, everyone else's
-- is declined. Idempotent on reassignment; no-ops without pending rows.
-- ============================================================================

create or replace function public.settle_job_applications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'taken'
     and new.assigned_to is not null
     and (old.status <> 'taken' or old.assigned_to is distinct from new.assigned_to) then

    update public.job_applications
    set status = 'accepted'
    where job_id = new.id
      and user_id = new.assigned_to
      and status = 'pending';

    update public.job_applications
    set status = 'declined'
    where job_id = new.id
      and user_id <> new.assigned_to
      and status = 'pending';
  end if;

  return new;
end $$;

drop trigger if exists jobs_settle_applications on public.jobs;

create trigger jobs_settle_applications
  after update on public.jobs
  for each row
  execute function public.settle_job_applications();
