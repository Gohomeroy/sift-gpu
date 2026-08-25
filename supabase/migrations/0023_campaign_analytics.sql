-- ============================================================================
-- SIFT — Migration 0023: Campaign analytics — budgets, spend, view history
--
-- Campaigns gain an optional budget. Every tracked view refresh now writes a
-- snapshot row (time series), so growth is chartable and spend is computed
-- from one authoritative SQL payout function instead of ad-hoc client math.
-- Analytics RPCs are org-member-gated SECURITY DEFINER helpers.
-- ============================================================================

begin;

alter table public.campaigns
  add column budget numeric(12, 2) check (budget >= 0);

comment on column public.campaigns.budget is
  'Total spend cap for this campaign. Null = uncapped / display-only.';

-- ----------------------------------------------------------------------------
-- View history: append-only snapshots written on every tracked refresh.
-- ----------------------------------------------------------------------------
create table public.campaign_entry_views (
  id              uuid primary key default gen_random_uuid(),
  entry_id        uuid not null references public.campaign_entries (id) on delete cascade,
  organization_id uuid not null,
  views           int not null check (views >= 0),
  recorded_at     timestamptz not null default now()
);

create index campaign_entry_views_entry_idx
  on public.campaign_entry_views (entry_id, recorded_at);
create index campaign_entry_views_org_idx
  on public.campaign_entry_views (organization_id, recorded_at);

alter table public.campaign_entry_views enable row level security;

create policy cev_select_member on public.campaign_entry_views
  for select to authenticated
  using (public.is_org_member(organization_id));

-- Writes happen only through record_entry_views() and the insert trigger.

-- ----------------------------------------------------------------------------
-- Payout math — single source of truth used by RPCs and the app.
-- ----------------------------------------------------------------------------
create or replace function public.campaign_entry_payout(
  p_views numeric,
  p_rate numeric,
  p_cap numeric
)
returns numeric
language sql
immutable
as $$
  select case
    when p_rate is null then 0::numeric
    else least(
      round(p_views / 1000.0 * p_rate, 2),
      coalesce(p_cap, round(p_views / 1000.0 * p_rate, 2))
    )
  end;
$$;

-- ----------------------------------------------------------------------------
-- record_entry_views(p_entry_id, p_views): snapshot + update in one atomic,
-- member-gated step. Called by the app after fetching a platform count.
-- Returns the entry's current payout.
-- ----------------------------------------------------------------------------
create or replace function public.record_entry_views(
  p_entry_id uuid,
  p_views int
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  e         public.campaign_entries;
  c         public.campaigns;
  v_payout  numeric;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.';
  end if;
  if p_views is null or p_views < 0 then
    raise exception 'View count must be zero or more.';
  end if;

  select * into e from public.campaign_entries where id = p_entry_id;
  if e.id is null then
    raise exception 'Entry not found.';
  end if;
  if not public.is_org_member(e.organization_id) then
    raise exception 'Not a member of this organization.';
  end if;

  insert into public.campaign_entry_views (entry_id, organization_id, views)
  values (e.id, e.organization_id, p_views);

  update public.campaign_entries
    set views = p_views, views_updated_at = now()
    where id = e.id;

  select * into c from public.campaigns where id = e.campaign_id;
  v_payout := public.campaign_entry_payout(
    p_views, c.rate_per_1k_views, c.max_payout_per_entry
  );
  return v_payout;
end $$;

-- Seed the series at submission time so every entry has history from 0.
create or replace function public.snapshot_entry_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.campaign_entry_views (entry_id, organization_id, views)
  values (new.id, new.organization_id, new.views);
  return new;
end $$;

create trigger campaign_entries_seed_snapshot
  after insert on public.campaign_entries
  for each row execute function public.snapshot_entry_insert();

-- ----------------------------------------------------------------------------
-- campaign_analytics(p_campaign_id): totals for the campaign dashboard.
-- Non-members get zero rows back.
-- ----------------------------------------------------------------------------
create or replace function public.campaign_analytics(p_campaign_id uuid)
returns table (
  total_entries       bigint,
  approved_entries    bigint,
  pending_entries     bigint,
  total_views         bigint,
  spent               numeric,
  pending_payout      numeric,
  avg_approved_views  numeric,
  budget              numeric,
  rate_per_1k_views   numeric,
  max_payout_per_entry numeric,
  remaining_budget    numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(e.id)::bigint,
    count(e.id) filter (where e.status = 'approved')::bigint,
    count(e.id) filter (where e.status = 'pending')::bigint,
    coalesce(sum(e.views) filter (where e.status = 'approved'), 0)::bigint,
    coalesce(sum(public.campaign_entry_payout(e.views, camp.rate_per_1k_views, camp.max_payout_per_entry))
      filter (where e.status = 'approved'), 0),
    coalesce(sum(public.campaign_entry_payout(e.views, camp.rate_per_1k_views, camp.max_payout_per_entry))
      filter (where e.status = 'pending'), 0),
    coalesce(avg(e.views) filter (where e.status = 'approved'), 0),
    camp.budget,
    camp.rate_per_1k_views,
    camp.max_payout_per_entry,
    case
      when camp.budget is null then null
      else camp.budget - coalesce(sum(public.campaign_entry_payout(e.views, camp.rate_per_1k_views, camp.max_payout_per_entry))
        filter (where e.status = 'approved'), 0)
    end
  from public.campaigns camp
  left join public.campaign_entries e on e.campaign_id = camp.id
  where camp.id = p_campaign_id
    and public.is_org_member(camp.organization_id)
  group by camp.id;
$$;

-- ----------------------------------------------------------------------------
-- org_campaign_analytics(p_org_id): roll-up across every campaign in an org.
-- ----------------------------------------------------------------------------
create or replace function public.org_campaign_analytics(p_org_id uuid)
returns table (
  campaigns_total bigint,
  campaigns_open  bigint,
  total_views     bigint,
  total_spent     numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    count(distinct c.id)::bigint,
    count(distinct c.id) filter (where c.status = 'open')::bigint,
    coalesce(sum(e.views) filter (where e.status = 'approved'), 0)::bigint,
    coalesce(sum(public.campaign_entry_payout(e.views, c.rate_per_1k_views, c.max_payout_per_entry))
      filter (where e.status = 'approved'), 0)
  from public.campaigns c
  left join public.campaign_entries e on e.campaign_id = c.id
  where c.organization_id = p_org_id
    and public.is_org_member(p_org_id)
  group by c.organization_id;
$$;

commit;
