-- ============================================================================
-- SIFT — Migration 0030: clip memory (per-workspace variation picking)
--
-- Problem: re-submitting the SAME video to the clipper produced the same clips
-- every time. Fix: record every clip the worker already made, per workspace +
-- source, so the next job picks DIFFERENT valid arc windows first, then re-clips
-- with different caption styles/themes, and finally builds supercut combos when
-- a video is truly exhausted.
--
-- Each row is one "clip decision":
--   window       → a fresh arc window never clipped before
--   style_variant→ the same window re-cut with a different caption combo
--   combo        → a multi-window supercut stitched together
-- The unique constraint stops the worker from repeating an identical decision.
-- ============================================================================

begin;

create table public.clip_memory (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_key      text not null,
  window_key      text not null,          -- "start-end" rounded to 0.1s
  kind            text not null default 'window'
                  check (kind in ('window', 'style_variant', 'combo')),
  style_sig       text not null default '',  -- style|font|sub|theme|reframe
  start_seconds   numeric(10, 2),
  end_seconds     numeric(10, 2),
  clip_id         uuid references public.clips (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (organization_id, source_key, window_key, kind, style_sig)
);

create index clip_memory_lookup_idx on public.clip_memory (organization_id, source_key);

alter table public.clip_memory enable row level security;
alter table public.clip_memory replica identity full;

-- Org members can read their workspace's clip decision history (no client
-- INSERT/DELETE: the worker writes through the service role).
create policy clip_memory_select_member on public.clip_memory
  for select to authenticated
  using (public.is_org_member(organization_id));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'clip_memory'
  ) then
    alter publication supabase_realtime add table public.clip_memory;
  end if;
end $$;

commit;