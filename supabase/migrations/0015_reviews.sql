-- ============================================================================
-- SIFT — Migration 0015: Reviews & per-org reputation (stage 8)
--
-- "Approvals close jobs and prompt reviews." One review per approved
-- submission: the approver rates the editor 1-5 with an optional note.
-- Reputation is DERIVED per-org from these rows (avg rating, review count,
-- completed jobs) — never stored on the global profile.
-- ============================================================================

begin;

create table public.reviews (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null unique references public.submissions (id) on delete cascade,
  organization_id uuid not null,
  reviewer_id     uuid not null references auth.users (id) on delete cascade,
  editor_id       uuid not null references auth.users (id) on delete cascade,
  rating          int  not null check (rating between 1 and 5),
  note            text check (char_length(note) <= 1000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index reviews_org_editor_idx on public.reviews (organization_id, editor_id);

create trigger reviews_touch_updated
  before update on public.reviews
  for each row execute function public.sift_touch_updated_at();

alter table public.reviews enable row level security;

-- The whole org sees its reviews — reputation is shared context.
create policy reviews_select_member on public.reviews
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Only approve_submissions holders review; never your own work; the target
-- submission must be approved, belong to the same org, and the editor_id
-- must be the submission's real editor (no forged attributions).
create policy reviews_insert_approver on public.reviews
  for insert to authenticated
  with check (
    reviewer_id = auth.uid()
    and reviewer_id <> editor_id
    and public.has_org_permission(organization_id, 'approve_submissions')
    and exists (
      select 1 from public.submissions s
      where s.id = submission_id
        and s.organization_id = organization_id
        and s.editor_id = editor_id
        and s.status = 'approved'
    )
  );

-- Reviewers may refine their own words.
create policy reviews_update_reviewer on public.reviews
  for update to authenticated
  using (reviewer_id = auth.uid())
  with check (reviewer_id = auth.uid());

create policy reviews_delete_reviewer on public.reviews
  for delete to authenticated
  using (reviewer_id = auth.uid());

commit;
