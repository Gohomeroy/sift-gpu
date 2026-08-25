-- ============================================================================
-- SIFT — Migration 0005: Submissions & revision workflow
-- One submission per job · versioned Drive-link deliveries (v1, v2, …) ·
-- timestamp-anchored comments · formal revision/approval transitions.
--
-- Version numbering happens inside submit_drive_link() so two rapid
-- deliveries can never collide on the same version number.
-- ============================================================================

begin;

create type public.submission_status as enum
  ('pending', 'revision_requested', 'approved', 'rejected');

-- ----------------------------------------------------------------------------
-- Submissions: one per job (the assigned editor's delivery thread)
-- ----------------------------------------------------------------------------

create table public.submissions (
  id              uuid primary key default gen_random_uuid(),
  job_id          uuid not null references public.jobs (id) on delete cascade,
  organization_id uuid not null,
  editor_id       uuid not null references auth.users (id) on delete cascade,
  status          public.submission_status not null default 'pending',
  revision_count  int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (job_id)
);

create index submissions_org_idx on public.submissions (organization_id);
create index submissions_editor_idx on public.submissions (editor_id);

create trigger submissions_touch_updated
  before update on public.submissions
  for each row execute function public.sift_touch_updated_at();

comment on column public.submissions.revision_count is
  'Number of formal revision REQUESTS. New deliveries create versions; they do not bump this counter.';

-- ----------------------------------------------------------------------------
-- Versions: immutable delivery snapshots, newest = highest number
-- ----------------------------------------------------------------------------

create table public.submission_versions (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references public.submissions (id) on delete cascade,
  organization_id uuid not null,
  version_number int not null,
  drive_file_id  text not null,
  drive_link     text not null,
  note           text,
  link_verified_at timestamptz,
  created_at     timestamptz not null default now(),
  unique (submission_id, version_number)
);

create index submission_versions_sub_idx on public.submission_versions (submission_id);

-- ----------------------------------------------------------------------------
-- Comments: optionally pinned to a playback second on a specific version
-- ----------------------------------------------------------------------------

create table public.comments (
  id                uuid primary key default gen_random_uuid(),
  version_id        uuid not null references public.submission_versions (id) on delete cascade,
  organization_id   uuid not null,
  author_id         uuid not null references auth.users (id) on delete cascade,
  body              text not null check (char_length(btrim(body)) between 1 and 2000),
  timestamp_seconds numeric(8, 2),
  resolved          boolean not null default false,
  created_at        timestamptz not null default now()
);

create index comments_version_idx on public.comments (version_id, created_at);

comment on column public.comments.timestamp_seconds is
  'Null = general comment. Otherwise the playback second this note is pinned to.';

-- ----------------------------------------------------------------------------
-- Drive URL parsing (shared by the deliver RPC)
-- ----------------------------------------------------------------------------

create or replace function public.parse_drive_file_id(p_url text)
returns text
language plpgsql immutable as $$
begin
  if p_url is null then
    return null;
  end if;

  -- https://drive.google.com/file/d/<ID>/view?usp=sharing
  declare m text := substring(p_url from '/file/d/([a-zA-Z0-9_-]{20,})');
  begin
    if m is not null then return m; end if;
  end;

  -- ...open?id=<ID> / uc?id=<ID> / download?id=<ID>
  declare n text := substring(p_url from '[?&]id=([a-zA-Z0-9_-]{20,})');
  begin
    if n is not null then return n; end if;
  end;

  return null;
end $$;

-- ----------------------------------------------------------------------------
-- RPC: deliver a Drive link (assigned editor only). Creates the submission on
-- first delivery and appends an incrementing version on every resubmission.
-- p_verified is supplied by the server action after checking public access.
-- ----------------------------------------------------------------------------

create or replace function public.submit_drive_link(
  p_job_id   uuid,
  p_url      text,
  p_note     text default null,
  p_verified boolean default false
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user     constant uuid := auth.uid();
  v_org      uuid;
  v_status   public.job_status;
  v_assigned uuid;
  sub        public.submissions%rowtype;
  v_version  int;
  v_file_id  text;
begin
  if v_user is null then
    raise exception 'Sign in first.';
  end if;

  select j.organization_id, j.status, j.assigned_to
  into v_org, v_status, v_assigned
  from public.jobs j
  where j.id = p_job_id;

  if v_org is null then
    raise exception 'Job not found.';
  end if;

  if v_assigned is null or v_assigned <> v_user then
    raise exception 'Only the assigned editor can deliver on this job.';
  end if;

  if v_status not in ('taken', 'in_review') then
    raise exception 'This job is not open for deliveries right now.';
  end if;

  v_file_id := public.parse_drive_file_id(p_url);
  if v_file_id is null then
    raise exception 'That does not look like a Google Drive file link.';
  end if;

  select * into sub from public.submissions where job_id = p_job_id;

  if not found then
    insert into public.submissions (job_id, organization_id, editor_id)
    values (p_job_id, v_org, v_user)
    returning * into sub;
  elsif sub.status = 'approved' then
    raise exception 'This submission was already approved.';
  end if;

  select coalesce(max(version_number), 0) + 1
  into v_version
  from public.submission_versions
  where submission_id = sub.id;

  insert into public.submission_versions
    (submission_id, organization_id, version_number, drive_file_id, drive_link, note, link_verified_at)
  values
    (sub.id, v_org, v_version, v_file_id, btrim(p_url), btrim(coalesce(p_note, '')),
     case when p_verified then now() else null end);

  -- A fresh delivery puts the ball back in review court.
  update public.jobs
  set status = 'in_review'
  where id = p_job_id and status = 'taken' and assigned_to = v_user;

  -- Back to pending whenever new work arrives.
  if sub.status = 'revision_requested' or sub.status = 'rejected' then
    update public.submissions set status = 'pending' where id = sub.id;
  end if;

  return sub.id;
end $$;

grant execute on function public.submit_drive_link(uuid, text, text, boolean) to authenticated;
revoke execute on function public.submit_drive_link(uuid, text, text, boolean) from anon, public;

-- ----------------------------------------------------------------------------
-- RPC: formal "Request Revision" (reviewers only)
-- ----------------------------------------------------------------------------

create or replace function public.request_revision(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_st   public.submission_status;
begin
  select organization_id, status into v_org, v_st
  from public.submissions where id = p_submission_id;

  if v_org is null then
    raise exception 'Submission not found.';
  end if;

  if not public.has_org_permission(v_org, 'review_submissions') then
    raise exception 'You do not have permission to review submissions.';
  end if;

  if v_st <> 'pending' then
    raise exception 'Only a fresh delivery can be sent back for revision.';
  end if;

  update public.submissions
  set status = 'revision_requested', revision_count = revision_count + 1
  where id = p_submission_id;
end $$;

grant execute on function public.request_revision(uuid) to authenticated;
revoke execute on function public.request_revision(uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- RPC: approve (reviewers only) — closes the submission AND its job
-- ----------------------------------------------------------------------------

create or replace function public.approve_submission(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_org  uuid;
  v_job  uuid;
  v_st   public.submission_status;
begin
  select organization_id, job_id, status into v_org, v_job, v_st
  from public.submissions where id = p_submission_id;

  if v_org is null then
    raise exception 'Submission not found.';
  end if;

  if not public.has_org_permission(v_org, 'approve_submissions') then
    raise exception 'You do not have permission to approve submissions.';
  end if;

  if v_st <> 'pending' then
    raise exception 'Approve the latest delivery while it is pending review.';
  end if;

  update public.submissions set status = 'approved' where id = p_submission_id;
  update public.jobs set status = 'completed' where id = v_job;
end $$;

grant execute on function public.approve_submission(uuid) to authenticated;
revoke execute on function public.approve_submission(uuid) from anon, public;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------

alter table public.submissions        enable row level security;
alter table public.submission_versions enable row level security;
alter table public.comments            enable row level security;

-- Visibility rule shared by all three tables:
-- org members who are EITHER the submission's editor OR hold review rights.

create policy submissions_select on public.submissions
  for select to authenticated
  using (
    editor_id = auth.uid()
    or public.has_org_permission(organization_id, 'review_submissions')
  );

-- Insert happens exclusively through submit_drive_link().
-- No INSERT policy on purpose.

create policy submissions_update_reviewer on public.submissions
  for update to authenticated
  using (public.has_org_permission(organization_id, 'review_submissions'))
  with check (public.has_org_permission(organization_id, 'review_submissions'));

create policy versions_select on public.submission_versions
  for select to authenticated
  using (
    exists (
      select 1 from public.submissions s
      where s.id = submission_id
        and (
          s.editor_id = auth.uid()
          or public.has_org_permission(s.organization_id, 'review_submissions')
        )
    )
  );

-- Version rows are immutable through the API; they are only written by the RPC.

create policy comments_select on public.comments
  for select to authenticated
  using (
    exists (
      select 1 from public.submissions s
      join public.submission_versions v on v.submission_id = s.id
      where v.id = comments.version_id
        and (
          s.editor_id = auth.uid()
          or public.has_org_permission(s.organization_id, 'review_submissions')
        )
    )
  );

create policy comments_insert_participant on public.comments
  for insert to authenticated
  with check (
    author_id = auth.uid()
    and exists (
      select 1 from public.submissions s
      join public.submission_versions v on v.submission_id = s.id
      where v.id = version_id
        and (
          s.editor_id = auth.uid()
          or public.has_org_permission(s.organization_id, 'review_submissions')
        )
    )
  );

-- Authors may resolve/unresolve their own notes; reviewers may resolve any.

create policy comments_update_resolver on public.comments
  for update to authenticated
  using (
    author_id = auth.uid()
    or exists (
      select 1 from public.submissions s
      join public.submission_versions v on v.submission_id = s.id
      where v.id = comments.version_id
        and public.has_org_permission(s.organization_id, 'review_submissions')
    )
  )
  with check (
    author_id = auth.uid()
    or exists (
      select 1 from public.submissions s
      join public.submission_versions v on v.submission_id = s.id
      where v.id = comments.version_id
        and public.has_org_permission(s.organization_id, 'review_submissions')
    )
  );

commit;
