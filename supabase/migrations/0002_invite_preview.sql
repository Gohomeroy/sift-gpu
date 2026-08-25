-- ============================================================================
-- SIFT — Migration 0002: Public invite preview
--
-- The /invite/[token] page runs BEFORE login (RLS would hide invite rows).
-- This SECURITY DEFINER RPC exposes the minimum needed to render that page —
-- org name/slug and target role — and only while the invite is still valid.
-- Tokens are 24 random bytes; possession of a valid token is the access proof.
-- ============================================================================

begin;

create or replace function public.invite_preview(p_token text)
returns table (org_name text, role_name text, org_slug text)
language plpgsql security definer set search_path = public as $$
declare
  inv public.organization_invites%rowtype;
begin
  select * into inv from public.organization_invites where token = btrim(p_token);

  if not found then
    return;
  end if;

  if inv.expires_at is not null and inv.expires_at <= now() then
    return;
  end if;

  if inv.max_uses is not null and inv.uses >= inv.max_uses then
    return;
  end if;

  select o.name, r.name, o.slug
  into org_name, role_name, org_slug
  from public.organizations o
  join public.roles r on r.id = inv.role_id
  where o.id = inv.organization_id
    and o.status = 'active';

  return;
end $$;

grant execute on function public.invite_preview(text) to anon, authenticated;
revoke execute on function public.invite_preview(text) from public;

commit;
