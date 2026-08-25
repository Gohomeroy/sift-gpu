-- ============================================================================
-- SIFT — Migration 0012: Broadcast-ready send RPC
--
-- postgres_changes delivery (WAL polling) swings between 0.4s and 9s+ on
-- shared Realtime — too slow for a live demo. The client now ALSO broadcasts
-- each sent message over the websocket for ~RTT delivery; this RPC returns
-- the full row so the sender has something to broadcast. postgres_changes
-- remains the authoritative fallback for missed broadcasts.
-- ============================================================================

drop function if exists public.send_chat_message(uuid, text);

create or replace function public.send_chat_message(
  p_channel_id uuid,
  p_body text
)
returns public.chat_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_org   uuid;
  v_row   public.chat_messages%rowtype;
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
  returning * into v_row;

  return v_row;
end $$;

grant execute on function public.send_chat_message(uuid, text) to authenticated;
revoke execute on function public.send_chat_message(uuid, text) from anon, public;
