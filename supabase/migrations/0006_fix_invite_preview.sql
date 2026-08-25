-- ============================================================================
-- SIFT — Migration 0006: Fix invite_preview returning zero rows
--
-- The PL/pgSQL version from 0002 assigned the RETURNS TABLE OUT-parameters
-- and executed a bare RETURN. Without RETURN NEXT / RETURN QUERY a
-- set-returning PL/pgSQL function emits nothing, so every /invite/[token]
-- page rendered "Invite unavailable" even for perfectly valid invites.
-- Rewritten as a LANGUAGE SQL function: the query result IS the return set.
-- ============================================================================

create or replace function public.invite_preview(p_token text)
returns table (org_name text, role_name text, org_slug text)
language sql
security definer
set search_path = public
stable
as $$
  select o.name, r.name, o.slug
  from public.organization_invites inv
  join public.organizations o on o.id = inv.organization_id
  join public.roles r on r.id = inv.role_id
  where inv.token = btrim(p_token)
    and (inv.expires_at is null or inv.expires_at > now())
    and (inv.max_uses is null or inv.uses < inv.max_uses)
    and o.status = 'active';
$$;

grant execute on function public.invite_preview(text) to anon, authenticated;
revoke execute on function public.invite_preview(text) from public;
