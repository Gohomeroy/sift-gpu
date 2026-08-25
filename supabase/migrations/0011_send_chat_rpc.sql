-- ============================================================================
-- SIFT — Migration 0011: Direct-send chat RPC
--
-- Chat sends previously went browser → Vercel server action → Supabase, so
-- every message waited on a serverless round trip (cold starts included)
-- before the INSERT even landed. This RPC lets the signed-in browser post
-- straight to Postgres in one hop: the server derives org + author, checks
-- send_chat, and inserts. The realtime INSERT event does the delivery.
-- ============================================================================

create or replace function public.send_chat_message(
  p_channel_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_org   uuid;
  v_msg   uuid;
begin
  if v_user is null then
    raise exception 'Sign in first.';
  end if;

  if btrim(p_body) = '' or char_length(p_body) > 2000 then
    raise exception 'Message must be 1-2000 characters.';
  end if;

  select organization_id into v_org
  from public.chat_channels
  where id = p_channel_id;

  if v_org is null then
    raise exception 'Channel not found.';
  end if;

  if not public.has_org_permission(v_org, 'send_chat') then
    raise exception 'You do not have permission to post in this workspace.';
  end if;

  insert into public.chat_messages (channel_id, organization_id, author_id, body)
  values (p_channel_id, v_org, v_user, btrim(p_body))
  returning id into v_msg;

  return v_msg;
end $$;

grant execute on function public.send_chat_message(uuid, text) to authenticated;
revoke execute on function public.send_chat_message(uuid, text) from anon, public;
