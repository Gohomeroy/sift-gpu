-- ============================================================================
-- SIFT — Migration 0021: Payout caps, linked accounts, view tracking
--
-- Campaigns gain structured payouts (rate per 1k views + per-video cap).
-- Clippers link their accounts once via a verification code scanned from the
-- account bio — entries must come from a verified linked account. Views are
-- tracked by the platform (refreshable), not self-reported at submission.
-- ============================================================================

begin;

alter table public.campaigns
  add column rate_per_1k_views numeric(10, 2) check (rate_per_1k_views >= 0),
  add column max_payout_per_entry numeric(10, 2) check (max_payout_per_entry >= 0);

comment on column public.campaigns.rate_per_1k_views is
  'Payout per 1000 tracked views. Null = display-only campaign.';
comment on column public.campaigns.max_payout_per_entry is
  'Hard cap per video. Null = uncapped.';

create table public.linked_accounts (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  platform          text not null check (platform in ('tiktok', 'youtube', 'instagram', 'other')),
  handle            text not null check (char_length(btrim(handle)) between 1 and 60),
  verification_code text not null default upper(substr(md5(random()::text), 1, 8)),
  verified_at       timestamptz,
  created_at        timestamptz not null default now(),
  unique (platform, handle)
);

alter table public.linked_accounts enable row level security;

create policy linked_accounts_select_own on public.linked_accounts
  for select to authenticated
  using (user_id = auth.uid());

create policy linked_accounts_insert_own on public.linked_accounts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy linked_accounts_update_own on public.linked_accounts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy linked_accounts_delete_own on public.linked_accounts
  for delete to authenticated
  using (user_id = auth.uid());

alter table public.campaign_entries
  add column linked_account_id uuid references public.linked_accounts (id) on delete set null,
  add column views_updated_at timestamptz;

commit;
