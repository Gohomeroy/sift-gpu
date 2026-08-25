-- ============================================================================
-- SIFT - Migration 0003: HOTFIX create_organization
-- Repairs `column "p" does not exist` (42703): the unnest() selects now use
-- an explicit column alias src(p). Safe to run on a project that already ran
-- 0001/0002 - it only replaces this one function.
-- ============================================================================

begin;
create or replace function public.create_organization(p_name text, p_slug text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_owner  constant uuid := auth.uid();
  v_org    uuid;
  r_owner  uuid;
  r_admin  uuid;
  r_editor uuid;
  r_member uuid;
begin
  if v_owner is null then
    raise exception 'You must be signed in.';
  end if;

  p_slug := lower(btrim(p_slug));
  p_name := btrim(p_name);

  if p_name !~* '^.{2,60}$' then
    raise exception 'Organization name must be 2-60 characters.';
  end if;

  if p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or char_length(p_slug) > 40 then
    raise exception 'Slug may contain lowercase letters, numbers and single hyphens (max 40).';
  end if;

  if p_slug = any (array[
    'api','auth','login','signin','signup','admin','dashboard','onboarding',
    'invite','invites','profile','settings','new','o','sift','jobs','chat','billing'
  ]) then
    raise exception '"%" is reserved. Pick another slug.', p_slug;
  end if;

  insert into public.organizations (name, slug, owner_id)
  values (p_name, p_slug, v_owner)
  returning id into v_org;

  -- Owner role: every permission toggled ON (matrix visible/editable in UI),
  -- plus implicit bypass in has_org_permission while they remain owner.
  -- Owner is the only immutable (is_system) role; every other role - including
  -- these seeds - is fully customizable/deletable by manage_roles holders,
  -- exactly like Discord's default roles.
  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Owner', '#f0a32b', 0, true)
  returning id into r_owner;

  insert into public.role_permissions (role_id, permission)
  select r_owner, src.p
  from unnest(enum_range(null::public.permission_key)) as src(p);

  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Admin', '#e5484d', 10, false)
  returning id into r_admin;

  insert into public.role_permissions (role_id, permission)
  select r_admin, src.p
  from unnest(enum_range(null::public.permission_key)) as src(p)
  where src.p <> 'manage_billing';

  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Editor', '#57c785', 20, false)
  returning id into r_editor;

  insert into public.role_permissions (role_id, permission)
  select r_editor, src.p
  from unnest(array[
    'claim_jobs_direct'::public.permission_key,
    'apply_to_jobs'::public.permission_key,
    'send_chat'::public.permission_key
  ]) as src(p);

  insert into public.roles (organization_id, name, color, position, is_system)
  values (v_org, 'Member', '#8a8577', 30, false)
  returning id into r_member;

  insert into public.role_permissions (role_id, permission)
  values (r_member, 'send_chat');

  insert into public.organization_members (organization_id, user_id)
  values (v_org, v_owner);

  insert into public.member_roles (organization_member_id, role_id, organization_id)
  select m.id, r_owner, v_org
  from public.organization_members m
  where m.organization_id = v_org and m.user_id = v_owner;

  return v_org;
end $$;

commit;
