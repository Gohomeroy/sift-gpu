-- ============================================================================
-- SIFT — Migration 0009: Admin panel (stage 5)
--
-- Platform staff operate the SaaS: suspend/reactivate organizations and set
-- plans. RLS deliberately gives platform admins NO client write path on
-- organizations, so these SECURITY DEFINER RPCs are the only mutation route.
-- Every call is guarded by is_platform_admin(); the existing audit trigger on
-- organizations records the change with the acting staff user as actor.
--
-- The boundary stays absolute: these RPCs touch org METADATA only. Platform
-- admins still cannot read rosters, chat, submissions, or audit rows.
-- ============================================================================

begin;

create or replace function public.admin_set_organization_status(
  p_org uuid,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform staff only.';
  end if;

  if p_status not in ('active', 'suspended') then
    raise exception 'Status must be active or suspended.';
  end if;

  update public.organizations
  set status = p_status::public.org_status
  where id = p_org;

  if not found then
    raise exception 'Organization not found.';
  end if;
end $$;

create or replace function public.admin_set_organization_plan(
  p_org uuid,
  p_plan text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Platform staff only.';
  end if;

  if p_plan not in ('free', 'pro', 'studio') then
    raise exception 'Plan must be free, pro or studio.';
  end if;

  update public.organizations
  set plan = p_plan::public.org_plan
  where id = p_org;

  if not found then
    raise exception 'Organization not found.';
  end if;
end $$;

grant execute on function
  public.admin_set_organization_status(uuid, text),
  public.admin_set_organization_plan(uuid, text)
to authenticated;
revoke execute on function
  public.admin_set_organization_status(uuid, text),
  public.admin_set_organization_plan(uuid, text)
from anon, public;

commit;
