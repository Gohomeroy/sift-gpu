-- ============================================================================
-- SIFT — Migration 0020a: add manage_campaigns to the permission matrix
--
-- Enum values must be committed before use, so this runs as its own
-- migration, separate from the campaign tables.
-- ============================================================================

alter type public.permission_key add value if not exists 'manage_campaigns';
