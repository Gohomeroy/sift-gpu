-- ============================================================================
-- SIFT — Migration 0013: Suspension actually cuts access
--
-- The roles-union branch of has_org_permission never checked org status, so
-- a suspended workspace stayed fully writable: the owner (and every member)
-- kept working through their seeded role permissions while the UI showed a
-- "read-only" banner. Suspension is now a hard off-switch — no permissions
-- flow in a non-active org, for anyone. Platform staff are unaffected (the
-- admin RPCs authorize via is_platform_admin, not this helper).
-- ============================================================================

create or replace function public.has_org_permission(p_org uuid, p_perm public.permission_key)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- Owners hold implicit full permission while their org is active.
  -- Everyone else: union of permissions across ALL roles they hold in this
  -- org. NOTHING grants permission inside a suspended organization.
  -- Platform admins intentionally get FALSE here — see header comment.
  select exists (
    select 1
    from public.organizations o
    where o.id = p_org
      and o.status = 'active'
      and (
        o.owner_id = auth.uid()
        or exists (
          select 1
          from public.organization_members m
          join public.member_roles mr on mr.organization_member_id = m.id
          join public.role_permissions rp on rp.role_id = mr.role_id
          where m.organization_id = o.id
            and m.user_id = auth.uid()
            and m.status = 'active'
            and rp.permission = p_perm
        )
      )
  );
$$;
