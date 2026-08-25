-- ============================================================================
-- SIFT — Migration 0019: Direct messages (Phase C)
--
-- 1:1 conversations between members of the same organization. Threads are
-- stored as an ordered user pair (a < b) so find-or-create is atomic on the
-- unique constraint. Messages mirror chat_messages minus channels; the
-- send RPC derives org + participant server-side and pings the recipient.
-- Attachments reuse the chat-attachments bucket under <org_id>/dm/<thread>/.
-- ============================================================================

begin;

create table public.dm_threads (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_a_id       uuid not null references auth.users (id) on delete cascade,
  user_b_id       uuid not null references auth.users (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (organization_id, user_a_id, user_b_id),
  check (user_a_id <> user_b_id),
  check (user_a_id < user_b_id)
);

create index dm_threads_org_idx on public.dm_threads (organization_id);

create table public.dm_messages (
  id              uuid primary key default gen_random_uuid(),
  thread_id       uuid not null references public.dm_threads (id) on delete cascade,
  organization_id uuid not null,
  sender_id       uuid not null references auth.users (id) on delete cascade,
  body            text not null default '' check (char_length(btrim(body)) <= 2000),
  attachment_path text,
  attachment_type text check (attachment_type in ('image', 'video')),
  attachment_name text,
  reply_to_id     uuid references public.dm_messages (id) on delete set null,
  edited_at       timestamptz,
  created_at      timestamptz not null default now()
);

create index dm_messages_thread_idx on public.dm_messages (thread_id, created_at);

alter table public.dm_threads enable row level security;
alter table public.dm_messages enable row level security;

-- Participants only — DMs are invisible to everyone else, including mods.
create policy dm_threads_select_participant on public.dm_threads
  for select to authenticated
  using (
    auth.uid() in (user_a_id, user_b_id)
    and public.is_org_member(organization_id)
  );

create policy dm_threads_insert_member on public.dm_threads
  for insert to authenticated
  with check (
    auth.uid() in (user_a_id, user_b_id)
    and user_a_id < user_b_id
    and public.has_org_permission(organization_id, 'send_chat')
    and exists (
      select 1 from public.organization_members m
      where m.organization_id = organization_id
        and m.status = 'active'
        and m.user_id = coalesce(nullif(user_a_id, auth.uid()), user_b_id)
    )
  );

create policy dm_messages_select_participant on public.dm_messages
  for select to authenticated
  using (
    exists (
      select 1 from public.dm_threads t
      where t.id = thread_id
        and auth.uid() in (t.user_a_id, t.user_b_id)
    )
  );

create policy dm_messages_insert_participant on public.dm_messages
  for insert to authenticated
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.dm_threads t
      where t.id = thread_id
        and auth.uid() in (t.user_a_id, t.user_b_id)
    )
    and public.has_org_permission(organization_id, 'send_chat')
  );

create policy dm_messages_update_sender on public.dm_messages
  for update to authenticated
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

create policy dm_messages_delete_sender on public.dm_messages
  for delete to authenticated
  using (sender_id = auth.uid());

-- ----------------------------------------------------------------------------
-- RPC: find-or-create a thread with another active member of the org.
-- ----------------------------------------------------------------------------

create or replace function public.open_dm_thread(
  p_org uuid,
  p_other_user uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_a     uuid;
  v_b     uuid;
  v_thread uuid;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;
  if v_me = p_other_user then
    raise exception 'You cannot DM yourself.';
  end if;
  if not public.has_org_permission(p_org, 'send_chat') then
    raise exception 'You do not have permission to message in this workspace.';
  end if;
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_org and user_id = p_other_user and status = 'active'
  ) then
    raise exception 'That person is not an active member of this workspace.';
  end if;

  v_a := least(v_me, p_other_user);
  v_b := greatest(v_me, p_other_user);

  select id into v_thread
  from public.dm_threads
  where organization_id = p_org and user_a_id = v_a and user_b_id = v_b;

  if v_thread is null then
    insert into public.dm_threads (organization_id, user_a_id, user_b_id)
    values (p_org, v_a, v_b)
    returning id into v_thread;
  end if;

  return v_thread;
end $$;

-- ----------------------------------------------------------------------------
-- RPC: send a DM. Participant + send_chat enforced server-side; pings the
-- recipient through the notification bell.
-- ----------------------------------------------------------------------------

create or replace function public.send_dm_message(
  p_thread_id uuid,
  p_body text,
  p_reply_to_id uuid default null,
  p_attachment_path text default null,
  p_attachment_type text default null
)
returns public.dm_messages
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_org   uuid;
  v_other uuid;
  v_row   public.dm_messages%rowtype;
begin
  if v_me is null then
    raise exception 'Sign in first.';
  end if;

  select organization_id,
         case when user_a_id = v_me then user_b_id else user_a_id end
  into v_org, v_other
  from public.dm_threads
  where id = p_thread_id
    and v_me in (user_a_id, user_b_id);

  if v_org is null then
    raise exception 'Conversation not found.';
  end if;

  if not public.has_org_permission(v_org, 'send_chat') then
    raise exception 'You do not have permission to message in this workspace.';
  end if;

  if coalesce(btrim(p_body), '') = '' and p_attachment_path is null then
    raise exception 'Message needs text or an attachment.';
  end if;

  if char_length(coalesce(p_body, '')) > 2000 then
    raise exception 'Message must be at most 2000 characters.';
  end if;

  if p_reply_to_id is not null and not exists (
    select 1 from public.dm_messages m
    where m.id = p_reply_to_id and m.thread_id = p_thread_id
  ) then
    raise exception 'The replied-to message must be in the same conversation.';
  end if;

  if p_attachment_path is not null
     and (storage.foldername(p_attachment_path))[1] <> v_org::text then
    raise exception 'Attachment does not belong to this workspace.';
  end if;

  insert into public.dm_messages (
    thread_id, organization_id, sender_id, body,
    reply_to_id, attachment_path, attachment_type
  )
  values (
    p_thread_id, v_org, v_me, btrim(coalesce(p_body, '')),
    p_reply_to_id, p_attachment_path, p_attachment_type
  )
  returning * into v_row;

  insert into public.notifications (organization_id, user_id, type, payload)
  values (
    v_org,
    v_other,
    'chat_dm',
    jsonb_build_object(
      'thread_id', p_thread_id,
      'sender_name', coalesce(
        (select display_name from public.profiles where id = v_me), 'Someone'
      )
    )
  );

  return v_row;
end $$;

grant execute on function public.open_dm_thread(uuid, uuid) to authenticated;
revoke execute on function public.open_dm_thread(uuid, uuid) from anon, public;
grant execute on function public.send_dm_message(uuid, text, uuid, text, text) to authenticated;
revoke execute on function public.send_dm_message(uuid, text, uuid, text, text) from anon, public;

-- ----------------------------------------------------------------------------
-- Notification type for DMs + realtime publication.
-- ----------------------------------------------------------------------------

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications
  add constraint notifications_type_check check (type in (
    'job_assigned',
    'submission_delivered',
    'revision_requested',
    'submission_approved',
    'chat_mention',
    'chat_dm'
  ));

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'dm_messages'
  ) then
    alter publication supabase_realtime add table public.dm_messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'dm_threads'
  ) then
    alter publication supabase_realtime add table public.dm_threads;
  end if;
end $$;

commit;
