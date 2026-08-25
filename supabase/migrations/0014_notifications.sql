-- ============================================================================
-- SIFT — Migration 0014: Notifications (stage 7)
--
-- In-app notifications written by SECURITY DEFINER triggers, so every code
-- path (RPCs, server actions, future clients) notifies identically:
--   job_assigned          — an editor is assigned a job
--   submission_delivered  — a version lands on a job the poster created
--   revision_requested    — the editor's submission is sent back
--   submission_approved   — the editor's submission is approved
-- Self-notifications (actor == recipient) are suppressed. RLS shows a user
-- only their own rows; marking read is a plain update on own rows.
-- ============================================================================

begin;

create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id         uuid not null references auth.users (id) on delete cascade,
  type            text not null check (type in (
                    'job_assigned',
                    'submission_delivered',
                    'revision_requested',
                    'submission_approved'
                  )),
  payload         jsonb not null default '{}'::jsonb,
  read_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id)
  where read_at is null;

alter table public.notifications enable row level security;

create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid());

create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_own on public.notifications
  for delete to authenticated
  using (user_id = auth.uid());

-- No INSERT policy: rows are written exclusively by the triggers below.

-- ----------------------------------------------------------------------------
-- Trigger helpers
-- ----------------------------------------------------------------------------

create or replace function public.notify_job_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_to is not null
     and new.assigned_to <> auth.uid()
     and (old.assigned_to is null or old.assigned_to <> new.assigned_to) then
    insert into public.notifications (organization_id, user_id, type, payload)
    values (
      new.organization_id,
      new.assigned_to,
      'job_assigned',
      jsonb_build_object('job_id', new.id, 'title', new.title)
    );
  end if;
  return new;
end $$;

create trigger notifications_job_assigned
  after update on public.jobs
  for each row execute function public.notify_job_assigned();

create or replace function public.notify_submission_delivered()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poster uuid;
  v_title  text;
begin
  select j.created_by, j.title into v_poster, v_title
  from public.jobs j
  where j.id = (
    select s.job_id from public.submissions s where s.id = new.submission_id
  );

  if v_poster is not null and v_poster <> auth.uid() then
    insert into public.notifications (organization_id, user_id, type, payload)
    values (
      new.organization_id,
      v_poster,
      'submission_delivered',
      jsonb_build_object(
        'submission_id', new.submission_id,
        'version_number', new.version_number,
        'title', v_title
      )
    );
  end if;
  return new;
end $$;

create trigger notifications_submission_delivered
  after insert on public.submission_versions
  for each row execute function public.notify_submission_delivered();

create or replace function public.notify_submission_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.editor_id = auth.uid() then
    return new; -- never notify the actor about their own submission
  end if;

  if new.status = 'revision_requested' and old.status <> 'revision_requested' then
    insert into public.notifications (organization_id, user_id, type, payload)
    values (
      new.organization_id,
      new.editor_id,
      'revision_requested',
      jsonb_build_object('submission_id', new.id, 'revision_count', new.revision_count)
    );
  elsif new.status = 'approved' and old.status <> 'approved' then
    insert into public.notifications (organization_id, user_id, type, payload)
    values (
      new.organization_id,
      new.editor_id,
      'submission_approved',
      jsonb_build_object('submission_id', new.id)
    );
  end if;

  return new;
end $$;

create trigger notifications_submission_status
  after update on public.submissions
  for each row execute function public.notify_submission_status();

-- Live badge: push notification changes through the realtime publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

commit;
