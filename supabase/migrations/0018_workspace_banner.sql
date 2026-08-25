-- ============================================================================
-- SIFT — Migration 0018: Workspace banner (Phase B)
--
-- Optional branding image per workspace. Stored in a public
-- `workspace-banners` bucket under <org_id>/…; uploading requires
-- access_admin_panel in that org, reading is public (it's branding).
-- Setting organizations.banner_path goes through the existing owner-only
-- organizations update policy.
-- ============================================================================

begin;

alter table public.organizations
  add column banner_path text;

comment on column public.organizations.banner_path is
  'Optional workspace banner image. Storage path in the workspace-banners bucket: <org_id>/<file>.';

insert into storage.buckets (id, name, public)
values ('workspace-banners', 'workspace-banners', true)
on conflict (id) do nothing;

create policy workspace_banners_public_read on storage.objects
  for select using (bucket_id = 'workspace-banners');

create policy workspace_banners_admin_write on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'workspace-banners'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'access_admin_panel')
  );

create policy workspace_banners_admin_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'workspace-banners'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'access_admin_panel')
  )
  with check (
    bucket_id = 'workspace-banners'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'access_admin_panel')
  );

create policy workspace_banners_admin_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'workspace-banners'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'access_admin_panel')
  );

commit;
