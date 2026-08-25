-- ============================================================================
-- SIFT — Migration 0010: Realtime for chat
--
-- Migration 0004 added public.jobs to the supabase_realtime publication; the
-- chat tables from 0008 were never added, so postgres_changes events never
-- fired for them. Idempotent: adding an already-member table would error,
-- so each add is guarded.
-- ============================================================================

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    alter publication supabase_realtime add table public.chat_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_channels'
  ) then
    alter publication supabase_realtime add table public.chat_channels;
  end if;
end $$;
