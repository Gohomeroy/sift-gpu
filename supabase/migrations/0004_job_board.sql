-- ============================================================================
-- SIFT — Migration 0004: Job board
-- Jobs scoped per org · configurable claim mode · atomic direct-claim RPC ·
-- apply/withdraw workflow · realtime publication · private briefs bucket.
--
-- Enforcement: same model as 0001. All policies call has_org_permission /
-- is_org_member. The claim RPC's WHERE status='open' guard makes the race
-- between two editors impossible at the row level.
-- ============================================================================

begin;

create extension if not exists pgcrypto;

create type public.job_status as enum
  ('open', 'taken', 'in_review', 'completed', 'cancelled');

create type public.claim_mode as enum ('direct', 'application');

create type public.application_status as enum
  ('pending', 'accepted', 'declined', 'withdrawn');

-- ----------------------------------------------------------------------------
-- Jobs
-- ----------------------------------------------------------------------------

create table public.jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title           text not null check (char_length(btrim(title)) between 3 and 120),
  description     text not null default '',
  category        text not null,
  pay_amount      numeric(12, 2),
  pay_currency    text not null default 'USD'
    check (pay_currency in ('USD', 'EUR', 'GBP')),
  pay_note        text,
  deadline        timestamptz,
  required_skills text[] not null default '{}',
  attachments     jsonb not null default '[]'::jsonb,
  status          public.job_status not null default 'open',
  claim_mode      public.claim_mode not null default 'application',
  created_by      uuid not null references auth.users (id) on delete cascade,
  assigned_to     uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column public.jobs.attachments is
  'Brief/reference files in the private `briefs` storage bucket. Entries: {path, name, size}. Path convention: `<org_id>/<job-scoped filename>`.';
comment on column public.jobs.pay_amount is
  'Null = negotiable/unpaid listing; pay_note explains.';
comment on column public.jobs.deadline is
  'Soft deadline for delivery; nullable.';

create index jobs_org_created_idx on public.jobs (organization_id, created_at desc);
create index jobs_org_status_idx on public.jobs (organization_id, status);
create index jobs_assigned_idx on public.jobs (assigned_to);

create trigger jobs_touch_updated
  before update on public.jobs
  for each row execute function public.sift_touch_updated_at();

-- Applications (apply-and-approve mode)
create table public.job_applications (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,
  organization_id uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  note            text,
  status          public.application_status not null default 'pending',
  created_at      timestamptz not null default now(),
  unique (job_id, user_id)
);

create index job_applications_job_idx on public.job_applications (job_id);
create index job_applications_user_idx on public.job_applications (user_id);

-- ----------------------------------------------------------------------------
-- Atomic direct claim — the race-proof path.
-- Two editors clicking "Claim" simultaneously: exactly one UPDATE matches
-- `status = 'open'`, so exactly one wins; everyone else gets a clean error.
-- ----------------------------------------------------------------------------

create or replace function public.claim_job(p_job_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user     constant uuid := auth.uid();
  v_org      uuid;
  v_mode     public.claim_mode;
  v_status   public.job_status;
begin
  if v_user is null then
    raise exception 'Sign in first.';
  end if;

  select organization_id, claim_mode, status
  into v_org, v_mode, v_status
  from public.jobs where id = p_job_id;

  if v_org is null then
    raise exception 'Job not found.';
  end if;

  if not public.has_org_permission(v_org, 'claim_jobs_direct') then
    raise exception 'You do not have permission to claim jobs here.';
  end if;

  if v_mode <> 'direct' then
    raise exception 'This job requires an application instead of a direct claim.';
  end if;

  if v_status <> 'open' then
    raise exception 'Someone already claimed this job.';
  end if;

  update public.jobs
  set status = 'taken', assigned_to = v_user
  where id = p_job_id and status = 'open';

  if not found then
    raise exception 'Someone already claimed this job.';
  end if;
end $$;

grant execute on function public.claim_job(uuid) to authenticated;
revoke execute on function public.claim_job(uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- Plan gating: active-job cap per subscription tier.
-- App-side UX check; the database stays authoritative via RLS regardless.
-- ----------------------------------------------------------------------------

create or replace function public.org_within_job_limits(p_org uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case o.plan
    when 'studio' then true
    when 'pro' then
      (select count(*) from public.jobs j
       where j.organization_id = p_org
         and j.status in ('open', 'taken', 'in_review')) < 50
    else
      (select count(*) from public.jobs j
       where j.organization_id = p_org
         and j.status in ('open', 'taken', 'in_review')) < 5
  end
  from public.organizations o
  where o.id = p_org;
$$;

grant execute on function public.org_within_job_limits(uuid) to authenticated;
revoke execute on function public.org_within_job_limits(uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.jobs             enable row level security;
alter table public.job_applications enable row level security;

-- jobs ------------------------------------------------------------------------

create policy jobs_select_member on public.jobs
  for select to authenticated
  using (public.is_org_member(organization_id));

create policy jobs_insert_poster on public.jobs
  for insert to authenticated with check (
    created_by = auth.uid()
    and public.has_org_permission(organization_id, 'post_jobs')
  );

-- post_jobs holders manage their board; review_submissions holders may drive
-- assignment transitions (approve applicant -> taken) without holding post_jobs.
create policy jobs_update_board on public.jobs
  for update to authenticated
  using (
    public.has_org_permission(organization_id, 'post_jobs')
    or (
      public.has_org_permission(organization_id, 'review_submissions')
      and status in ('open', 'taken')
    )
  )
  with check (
    public.has_org_permission(organization_id, 'post_jobs')
    or (
      public.has_org_permission(organization_id, 'review_submissions')
      and status in ('open', 'taken')
    )
  );

create policy jobs_delete_poster on public.jobs
  for delete to authenticated
  using (public.has_org_permission(organization_id, 'post_jobs'));

-- job_applications --------------------------------------------------------------

create policy applications_select on public.job_applications
  for select to authenticated
  using (
    public.is_org_member(organization_id)
    and (
      user_id = auth.uid()
      or public.has_org_permission(organization_id, 'review_submissions')
    )
  );

create policy applications_insert_apply on public.job_applications
  for insert to authenticated with check (
    user_id = auth.uid()
    and public.has_org_permission(organization_id, 'apply_to_jobs')
    and exists (
      select 1 from public.jobs j
      where j.id = job_id
        and j.organization_id = organization_id
        and j.status = 'open'
        and j.claim_mode = 'application'
    )
  );

create policy applications_update on public.job_applications
  for update to authenticated
  using (
    (
      user_id = auth.uid()
      and status = 'pending'
    )
    or public.has_org_permission(organization_id, 'review_submissions')
  )
  with check (
    (
      user_id = auth.uid()
      and status = 'pending'
    )
    or public.has_org_permission(organization_id, 'review_submissions')
  );

create policy applications_delete_withdraw on public.job_applications
  for delete to authenticated
  using (user_id = auth.uid() and status = 'pending');

-- ----------------------------------------------------------------------------
-- Realtime: live board updates
-- ----------------------------------------------------------------------------

alter publication supabase_realtime add table public.jobs;

-- ----------------------------------------------------------------------------
-- Storage: briefs (private bucket, org-scoped folders)
-- Path convention: `<org_uuid>/<filename>` enforced by foldername checks.
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('briefs', 'briefs', false)
on conflict (id) do nothing;

create policy briefs_member_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'briefs'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy briefs_poster_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'briefs'
    and public.has_org_permission(
      ((storage.foldername(name))[1])::uuid, 'post_jobs'
    )
  );

create policy briefs_poster_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'briefs'
    and public.has_org_permission(
      ((storage.foldername(name))[1])::uuid, 'post_jobs'
    )
  );

create policy briefs_poster_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'briefs'
    and public.has_org_permission(
      ((storage.foldername(name))[1])::uuid, 'post_jobs'
    )
  );

commit;
