"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { editDmMessageAction, deleteDmMessageAction } from "@/app/actions/dms";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty";
import { Modal } from "@/components/ui/modal";
import { ProfileCard } from "@/components/profile-card";
import { useOrgPresence } from "@/lib/use-presence";
import { Composer, MessageRow } from "./chat-room";
import { ChannelSidebar } from "./channel-sidebar";
import type { ChatChannel } from "@/lib/types";

export type DmThreadView = {
  id: string;
  other_name: string;
  other_avatar: string | null;
};

export type DmMessageView = {
  id: string;
  thread_id: string;
  sender_id: string;
  body: string;
  attachment_path: string | null;
  attachment_type: "image" | "video" | null;
  attachment_name: string | null;
  reply_to_id: string | null;
  edited_at: string | null;
  created_at: string;
};

type ProfileInfo = { display_name: string; avatar_url: string | null };
type LiveState = "connecting" | "live" | "polling";
type PickableMember = { user_id: string; display_name: string; avatar_url: string | null };

export function DmRoom({
  slug,
  organizationId,
  channels,
  canModerate,
  activeThread,
  otherUserId,
  otherUser,
  initialMessages,
  currentUserId,
  canSend,
}: {
  slug: string;
  organizationId: string;
  channels: ChatChannel[];
  canModerate: boolean;
  activeThread: DmThreadView | null;
  otherUserId: string | null;
  otherUser: ProfileInfo | null;
  initialMessages: DmMessageView[];
  currentUserId: string;
  canSend: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const online = useOrgPresence(organizationId, currentUserId);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const activeThreadId = activeThread?.id ?? "";

  const [messages, setMessages] = useState(initialMessages);
  const [adopted, setAdopted] = useState(initialMessages);
  const [live, setLive] = useState<LiveState>("connecting");
  const [replyTo, setReplyTo] = useState<DmMessageView | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  if (adopted !== initialMessages) {
    setAdopted(initialMessages);
    setMessages(initialMessages);
  }

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeThreadId]);

  const refreshFromServer = useCallback(async () => {
    if (!activeThreadId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("dm_messages")
      .select("*")
      .eq("thread_id", activeThreadId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data) return;
    setMessages((data as unknown as DmMessageView[]).slice().reverse());
  }, [activeThreadId]);

  useEffect(() => {
    const tick = () => void refreshFromServer();
    const initial = setTimeout(tick, 0);
    const poll = setInterval(tick, 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
    };
  }, [refreshFromServer]);

  const channelRef = useRef<RealtimeChannel | null>(null);

  useEffect(() => {
    if (!activeThreadId) return;
    const supabase = createClient();

    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      supabase.realtime.setAuth(session?.access_token ?? "");
    })();

    const ingestRow = (row: DmMessageView) => {
      if (row.thread_id !== activeThreadId) return;
      setMessages((current) =>
        current.some((m) => m.id === row.id) ? current : [...current, row],
      );
    };

    const channel = supabase
      .channel(`rt-dm-${activeThreadId}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "new-message" }, (msg) => {
        const row = (msg as { payload?: DmMessageView }).payload;
        if (row) ingestRow(row);
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "dm_messages",
          filter: `thread_id=eq.${activeThreadId}`,
        },
        (payload) => ingestRow(payload.new as DmMessageView),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") setLive("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT")
          setLive("polling");
      });

    channelRef.current = channel;

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [activeThreadId]);

  const sendMessage = useCallback(
    async (
      chId: string,
      body: string,
      replyToId: string | null,
      attachmentPath: string | null,
      attachmentType: "image" | "video" | null,
    ) => {
      void chId;
      const supabase = createClient();
      const { data: row, error } = await supabase.rpc("send_dm_message", {
        p_thread_id: activeThreadId,
        p_body: body,
        p_reply_to_id: replyToId,
        p_attachment_path: attachmentPath,
        p_attachment_type: attachmentType,
      });
      if (error || !row) {
        setMessages((current) =>
          current.filter(
            (m) =>
              !(
                m.id.startsWith("temp-") &&
                m.body === body &&
                m.attachment_path === attachmentPath
              ),
          ),
        );
        setSendError(error ? error.message : "Couldn't send the message.");
        return false;
      }
      channelRef.current?.send({
        type: "broadcast",
        event: "new-message",
        payload: row,
      });
      return true;
    },
    [activeThreadId],
  );

  function appendOptimistic(msg: {
    body: string;
    attachmentPath: string | null;
    attachmentType: "image" | "video" | null;
    attachmentName: string | null;
    replyToId: string | null;
  }) {
    setMessages((current) => [
      ...current,
      {
        id: `temp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        thread_id: activeThreadId,
        sender_id: currentUserId,
        body: msg.body,
        attachment_path: msg.attachmentPath,
        attachment_type: msg.attachmentType,
        attachment_name: msg.attachmentName,
        reply_to_id: msg.replyToId,
        edited_at: null,
        created_at: new Date().toISOString(),
      },
    ]);
  }

  const byId = new Map(messages.map((m) => [m.id, m]));
  const profiles: Record<string, ProfileInfo> = {
    [currentUserId]: { display_name: "You", avatar_url: null },
    ...(otherUserId && otherUser ? { [otherUserId]: otherUser } : {}),
  };

  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-[200px_1fr]">
      <div className="min-h-0 md:overflow-y-auto">
        <ChannelSidebar
          slug={slug}
          organizationId={organizationId}
          channels={channels}
          activeSlug={null}
          canModerate={canModerate}
        />
      </div>

      <section className="grid min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg border border-line bg-panel">
        <header className="flex items-center gap-2.5 border-b border-line px-4 py-2.5">
          {otherUser && (
            <button
              type="button"
              onClick={() => setProfileUserId(otherUserId)}
              title="View profile"
              className="relative shrink-0 cursor-pointer rounded-full"
            >
              <Avatar name={otherUser.display_name} url={otherUser.avatar_url ?? undefined} size="sm" />
              <span
                aria-hidden
                className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-panel ${
                  online.has(otherUserId ?? "") ? "bg-ok" : "bg-line-strong"
                }`}
              />
            </button>
          )}
          <button
            type="button"
            onClick={() => otherUserId && setProfileUserId(otherUserId)}
            className="cursor-pointer text-sm font-medium text-ink hover:text-accent hover:underline"
          >
            {otherUser?.display_name ?? "Direct message"}
          </button>
          <span
            title={
              live === "live"
                ? "Realtime connected"
                : "Realtime unavailable — syncing every 10s"
            }
            className={`ml-auto inline-flex shrink-0 items-center gap-1.5 font-mono text-[10px] tracking-[0.08em] uppercase ${
              live === "live" ? "text-ok" : "text-faint"
            }`}
          >
            <span
              aria-hidden
              className={`size-1.5 rounded-full ${
                live === "live" ? "bg-ok" : "bg-faint"
              }`}
            />
            {live}
          </span>
        </header>

        <div ref={scrollRef} className="min-h-0 overflow-y-auto px-4 py-3">
          {messages.length === 0 ? (
            <EmptyState
              title="No messages yet"
              hint={`Say hi to ${otherUser?.display_name ?? "them"}.`}
            />
          ) : (
            <ul className="grid gap-0.5">
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                const grouped =
                  prev !== undefined &&
                  prev.sender_id === m.sender_id &&
                  !m.reply_to_id &&
                  !m.id.startsWith("temp-") &&
                  !prev.id.startsWith("temp-") &&
                  new Date(m.created_at).getTime() -
                    new Date(prev.created_at).getTime() <
                    5 * 60_000;
                return (
                  <MessageRow
                    key={m.id}
                    message={{
                      id: m.id,
                      channel_id: m.thread_id,
                      author_id: m.sender_id,
                      body: m.body,
                      edited_at: m.edited_at,
                      created_at: m.created_at,
                      attachment_path: m.attachment_path,
                      attachment_type: m.attachment_type,
                      attachment_name: m.attachment_name,
                      reply_to_id: m.reply_to_id,
                      mentions: [],
                    }}
                    parentPreview={
                      m.reply_to_id
                        ? (() => {
                            const p = byId.get(m.reply_to_id!);
                            if (!p) return null;
                            return {
                              name: profiles[p.sender_id]?.display_name ?? "member",
                              body: p.body || p.attachment_name || "attachment",
                            };
                          })()
                        : null
                    }
                    profile={profiles[m.sender_id]}
                    grouped={grouped}
                    slug={slug}
                    memberNames={[]}
                    canEdit={m.sender_id === currentUserId && !m.id.startsWith("temp-")}
                    canDelete={m.sender_id === currentUserId}
                    onReply={() => setReplyTo(m)}
                    editAction={editDmMessageAction}
                    deleteAction={deleteDmMessageAction}
                    online={online.has(m.sender_id)}
                    isSelf={m.sender_id === currentUserId}
                    onOpenProfile={() => setProfileUserId(m.sender_id)}
                  />
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-line p-3">
          {canSend ? (
            <>
              {sendError && <Alert kind="error">{sendError}</Alert>}
              <Composer
                channelId={activeThreadId ? `dm/${activeThreadId}` : ""}
                organizationId={organizationId}
                members={[]}
                replyTo={
                  replyTo
                    ? {
                        id: replyTo.id,
                        channel_id: replyTo.thread_id,
                        author_id: replyTo.sender_id,
                        body: replyTo.body,
                        edited_at: replyTo.edited_at,
                        created_at: replyTo.created_at,
                        attachment_path: replyTo.attachment_path,
                        attachment_type: replyTo.attachment_type,
                        attachment_name: replyTo.attachment_name,
                        reply_to_id: null,
                        mentions: [],
                      }
                    : null
                }
                onCancelReply={() => setReplyTo(null)}
                onOptimistic={appendOptimistic}
                onSend={sendMessage}
              />
            </>
          ) : (
            <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-center text-xs text-faint">
              You don&apos;t have permission to message in this workspace.
            </p>
          )}
        </div>
      </section>

      {profileUserId && (
        <ProfileCard
          key={profileUserId}
          open
          onClose={() => setProfileUserId(null)}
          slug={slug}
          organizationId={organizationId}
          userId={profileUserId}
          fallbackName="member"
          online={online.has(profileUserId)}
          canSend={canSend}
        />
      )}
    </div>
  );
}

export function DmList({
  slug,
  threads,
  activeThreadId,
  onNew,
}: {
  slug: string;
  threads: DmThreadView[];
  activeThreadId: string | null;
  onNew: () => void;
}) {
  return (
    <div className="mt-4 grid content-start gap-1">
      <div className="flex items-center justify-between px-2">
        <h2 className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
          Direct messages
        </h2>
        <button
          type="button"
          onClick={onNew}
          title="New direct message"
          aria-label="New direct message"
          className="cursor-pointer rounded p-0.5 text-faint transition-colors hover:bg-raised hover:text-ink"
        >
          <MessageSquare size={14} />
        </button>
      </div>
      {threads.length === 0 ? (
        <p className="px-3 py-1.5 text-xs text-faint">None yet</p>
      ) : (
        threads.map((t) => (
          <a
            key={t.id}
            href={`/o/${slug}/chat?dm=${t.id}`}
            className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors ${
              t.id === activeThreadId
                ? "bg-raised font-medium text-accent"
                : "text-muted hover:bg-raised hover:text-ink"
            }`}
          >
            <Avatar name={t.other_name} url={t.other_avatar ?? undefined} size="sm" />
            <span className="truncate">{t.other_name}</span>
          </a>
        ))
      )}
    </div>
  );
}

export function NewDmModal({
  open,
  onClose,
  slug,
  organizationId,
  members,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  organizationId: string;
  members: PickableMember[];
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openThread(otherUserId: string) {
    setBusyId(otherUserId);
    setError(null);
    const supabase = createClient();
    const { data: threadId, error: rpcErr } = await supabase.rpc(
      "open_dm_thread",
      { p_org: organizationId, p_other_user: otherUserId },
    );
    setBusyId(null);
    if (rpcErr || !threadId) {
      setError(rpcErr ? rpcErr.message : "Couldn't open the conversation.");
      return;
    }
    onClose();
    router.push(`/o/${slug}/chat?dm=${threadId}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="New direct message">
      <div className="grid gap-1">
        {members.length === 0 && (
          <p className="px-1 py-3 text-sm text-muted">No one to message yet.</p>
        )}
        {members.map((m) => (
          <button
            key={m.user_id}
            type="button"
            disabled={busyId !== null}
            onClick={() => void openThread(m.user_id)}
            className="flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink disabled:cursor-wait disabled:opacity-60"
          >
            <Avatar name={m.display_name} url={m.avatar_url ?? undefined} size="sm" />
            {m.display_name}
          </button>
        ))}
        {error && <Alert kind="error">{error}</Alert>}
      </div>
    </Modal>
  );
}
