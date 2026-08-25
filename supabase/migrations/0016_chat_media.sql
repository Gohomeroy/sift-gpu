-- ============================================================================
-- SIFT — Migration 0016: Chat attachments, replies, mentions (Phase A)
--
-- Messages gain media attachments (images/videos ≤5MB, private storage
-- bucket, org-gated policies), reply-to threading, and @mentions that ping
-- (a new notification type delivered by trigger, same as the rest).
-- ============================================================================

begin;

alter table public.chat_messages
  add column attachment_path text,
  add column attachment_type text check (attachment_type in ('image', 'video')),
  add column attachment_name text,
  add column reply_to_id uuid references public.chat_messages (id) on delete set null,
  add column mentions uuid[] not null default '{}';

create index chat_messages_reply_idx on public.chat_messages (reply_to_id)
  where reply_to_id is not null;

-- Widen the notification type set for pings.
alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'job_assigned',
    'submission_delivered',
    'revision_requested',
    'submission_approved',
    'chat_mention'
  ));

-- ----------------------------------------------------------------------------
-- Send RPC: attachment + reply + mention params. Reply must live in the same
-- channel; attachment path must sit inside this org's folder.
-- ----------------------------------------------------------------------------

drop function if exists public.send_chat_message(uuid, text);

create or replace function public.send_chat_message(
  p_channel_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_attachment_path text default null,
  p_attachment_type text default null,
  p_mentions uuid[] default '{}'
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

  select organization_id into v_org
  from public.chat_channels
  where id = p_channel_id;

  if v_org is null then
    raise exception 'Channel not found.';
  end if;

  if not public.has_org_permission(v_org, 'send_chat') then
    raise exception 'You do not have permission to post in this workspace.';
  end if;

  if coalesce(btrim(p_body), '') = '' and p_attachment_path is null then
    raise exception 'Message needs text or an attachment.';
  end if;

  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'Message must be at most 2000 characters.';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1 from public.chat_messages m
    where m.id = p_reply_to_id and m.channel_id = p_channel_id
  ) then
    raise exception 'The replied-to message must be in the same channel.';
  end if;

  if p_attachment_path is not null
     and (storage.foldername(p_attachment_path))[1] <> v_org::text then
    raise exception 'Attachment does not belong to this workspace.';
  end if;

  insert into public.chat_messages (
    channel_id, organization_id, author_id, body,
    reply_to_id, attachment_path, attachment_type, mentions
  )
  values (
    p_channel_id, v_org, v_user, btrim(coalesce(p_body, '')),
    p_reply_to_id, p_attachment_path, p_attachment_type, p_mentions
  )
  returning * into v_row;

  -- Pings: notify every mentioned member who isn't the sender.
  insert into public.notifications (organization_id, user_id, type, payload)
  select
    v_org,
    m,
    'chat_mention',
    jsonb_build_object(
      'message_id', v_row.id,
      'channel_id', p_channel_id,
      'channel_name', (select name from public.chat_channels where id = p_channel_id),
      'channel_slug', (select slug from public.chat_channels where id = p_channel_id),
      'author_id', v_user,
      'author_name', coalesce(
        (select display_name from public.profiles where id = v_user), 'Someone'
      )
    )
  from unnest(p_mentions) m
  where m <> v_user
    and m in (
      select user_id from public.organization_members
      where organization_id = v_org and status = 'active'
    );

  return v_row;
end $$;

grant execute on function public.send_chat_message(uuid, text, uuid, text, text, uuid[])
  to authenticated;
revoke execute on function public.send_chat_message(uuid, text, uuid, text, text, uuid[])
  from anon, public;

-- ----------------------------------------------------------------------------
-- Storage: private chat-attachments bucket, one folder per org.
-- Path contract: <org_id>/<channel_id>/<uuid>.<ext>
-- ----------------------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('chat-attachments', 'chat-attachments', false)
on conflict (id) do nothing;

create policy chat_attachments_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'chat-attachments'
    and public.has_org_permission(((storage.foldername(name))[1])::uuid, 'send_chat')
  );

create policy chat_attachments_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

create policy chat_attachments_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-attachments'
    and public.is_org_member(((storage.foldername(name))[1])::uuid)
  );

commit;
