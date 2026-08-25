-- ============================================================================
-- SIFT — Migration 0017: Allow attachment-only chat messages
--
-- The original body check demanded 1-2000 characters unconditionally, so a
-- picture/video with no caption was rejected. A message now needs text OR
-- an attachment.
-- ============================================================================

alter table public.chat_messages drop constraint chat_messages_body_check;

alter table public.chat_messages
  add constraint chat_messages_body_check
  check (char_length(btrim(body)) between 1 and 2000 or attachment_path is not null);
