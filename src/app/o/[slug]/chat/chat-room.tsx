"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  CornerUpLeft,
  Hash,
  ImagePlus,
  Paperclip,
  Pencil,
  SendHorizonal,
  Smile,
  X,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import {
  deleteMessageAction,
  editMessageAction,
} from "@/app/actions/chat";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DangerButton } from "@/components/ui/danger-button";
import { EmptyState } from "@/components/ui/empty";
import { ProfileCard } from "@/components/profile-card";
import { useOrgPresence } from "@/lib/use-presence";
import { ChannelSidebar } from "./channel-sidebar";
import { NewDmModal, type DmThreadView } from "./dm-room";
import type { ChatChannel } from "@/lib/types";

export type ChatMessageView = {
  id: string;
  channel_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  created_at: string;
  attachment_path: string | null;
  attachment_type: "image" | "video" | null;
  attachment_name: string | null;
  reply_to_id: string | null;
  mentions: string[];
};

type ProfileInfo = { display_name: string; avatar_url: string | null };
type ChatMember = { user_id: string; display_name: string; avatar_url: string | null };
type LiveState = "connecting" | "live" | "polling";

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const EMOJIS = [
  "😂","🔥","💯","😍","😮","😢","😡","🎉","👀","💀",
  "🙌","👏","👍","👎","❤️","🚀","🎬","✂️","📈","🤝",
  "😅","🤔","😎","🥳","🤯","😤",
];
// ---------------------------------------------------------------------------
// Attachments: signed URLs (private bucket), cached per path.
// ---------------------------------------------------------------------------

const urlCache = new Map<string, string>();

async function attachmentUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit) return hit;
  const supabase = createClient();
  const { data } = await supabase.storage
    .from("chat-attachments")
    .createSignedUrl(path, 3600);
  if (data?.signedUrl) {
    urlCache.set(path, data.signedUrl);
    return data.signedUrl;
  }
  return null;
}

function ChatAttachment({
  path,
  type,
  name,
}: {
  path: string;
  type: "image" | "video";
  name: string | null;
}) {
  const [url, setUrl] = useState<string | null>(urlCache.get(path) ?? null);

  useEffect(() => {
    if (url) return;
    let alive = true;
    void attachmentUrl(path).then((u) => {
      if (alive && u) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path, url]);

  if (!url) {
    return <div className="h-32 w-48 animate-pulse rounded-md bg-raised" aria-label="Loading attachment" />;
  }
  if (type === "image") {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block w-fit">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={name ?? "shared image"}
          className="max-h-64 rounded-md border border-line"
        />
      </a>
    );
  }
  return <video src={url} controls className="max-h-64 rounded-md border border-line" />;
}

// ---------------------------------------------------------------------------
// Mention highlighting: @Name tokens for known members render in accent.
// ---------------------------------------------------------------------------

function renderBody(
  body: string,
  memberNames: string[],
): React.ReactNode[] {
  if (memberNames.length === 0) return [body];
  const escaped = memberNames
    .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  const re = new RegExp(`@(${escaped.join("|")})\\b`, "g");

  const nodes: React.ReactNode[] = [];
  let last = 0;
  for (const match of body.matchAll(re)) {
    const idx = match.index ?? 0;
    if (idx > last) nodes.push(body.slice(last, idx));
    nodes.push(
      <span key={`${idx}-${match[0]}`} className="rounded bg-accent/10 px-0.5 font-medium text-accent">
        {match[0]}
      </span>,
    );
    last = idx + match[0].length;
  }
  if (last < body.length) nodes.push(body.slice(last));
  return nodes;
}

export function ChatRoom({
  slug,
  organizationId,
  channels,
  activeChannel,
  initialMessages,
  initialProfiles,
  members,
  dmThreads,
  activeDmId = null,
  currentUserId,
  canSend,
  canModerate,
}: {
  slug: string;
  organizationId: string;
  channels: ChatChannel[];
  activeChannel: ChatChannel | null;
  initialMessages: ChatMessageView[];
  initialProfiles: Record<string, ProfileInfo>;
  members: ChatMember[];
  dmThreads: DmThreadView[];
  activeDmId?: string | null;
  currentUserId: string;
  canSend: boolean;
  canModerate: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const online = useOrgPresence(organizationId, currentUserId);
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [newDmOpen, setNewDmOpen] = useState(false);

  // Messages live in local state; the server list is adopted whenever it
  // changes (navigation, revalidation) and realtime events patch it in place,
  // so nothing ever needs a manual refresh.
  const [messages, setMessages] = useState(initialMessages);
  const [profiles, setProfiles] = useState<Record<string, ProfileInfo>>(initialProfiles);
  const [adoptedMessages, setAdoptedMessages] = useState(initialMessages);
  const [adoptedProfiles, setAdoptedProfiles] = useState(initialProfiles);
  const [live, setLive] = useState<LiveState>("connecting");
  const [replyTo, setReplyTo] = useState<ChatMessageView | null>(null);

  // React's sanctioned prop-adjustment pattern: adopt new server data during
  // render when the props identity changes.
  if (adoptedMessages !== initialMessages) {
    setAdoptedMessages(initialMessages);
    setMessages(initialMessages);
  }
  if (adoptedProfiles !== initialProfiles) {
    setAdoptedProfiles(initialProfiles);
    setProfiles((prev) => ({ ...prev, ...initialProfiles }));
  }

  const activeChannelId = activeChannel?.id ?? "";
  const memberNames = useMemo(() => members.map((m) => m.display_name), [members]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, activeChannelId]);

  const fetchedProfiles = useRef(new Set<string>());
  const ensureProfile = useCallback(async (authorId: string) => {
    if (fetchedProfiles.current.has(authorId)) return;
    fetchedProfiles.current.add(authorId);
    const supabase = createClient();
    const { data } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .eq("id", authorId)
      .maybeSingle();
    if (data) {
      setProfiles((prev) => ({
        ...prev,
        [authorId]: { display_name: data.display_name, avatar_url: data.avatar_url },
      }));
    }
  }, []);

  // Server-sync backstop: reconciles the list even if websockets are blocked
  // or an event is missed. Cheap query, rare duplicates are merged away.
  const refreshFromServer = useCallback(async () => {
    if (!activeChannelId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("chat_messages")
      .select("*")
      .eq("channel_id", activeChannelId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (!data) return;
    const server = (data as unknown as ChatMessageView[]).slice().reverse();
    for (const m of server) void ensureProfile(m.author_id);
    setMessages((current) => {
      const stillInFlight = current.filter(
        (m) =>
          m.id.startsWith("temp-") &&
          !server.some(
            (s) =>
              s.author_id === m.author_id &&
              s.body === m.body &&
              s.attachment_path === m.attachment_path,
          ),
      );
      return [...server, ...stillInFlight];
    });
  }, [activeChannelId, ensureProfile]);

  useEffect(() => {
    const tick = () => void refreshFromServer();
    const initial = setTimeout(tick, 0);
    const poll = setInterval(tick, 10_000);
    return () => {
      clearTimeout(initial);
      clearInterval(poll);
    };
  }, [refreshFromServer]);

  useEffect(() => {
    const supabase = createClient();

    // Realtime authorizes postgres_changes against RLS using the JWT sent
    // with the channel join — attach the session token BEFORE subscribing,
    // otherwise the server treats us as anon and withholds every event.
    void (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      supabase.realtime.setAuth(session?.access_token ?? "");
    })();

    // One ingestion path for both broadcast (fast) and postgres_changes
    // (authoritative): dedupe by id, swap out the sender's optimistic copy.
    const ingestRow = (row: ChatMessageView) => {
      if (row.channel_id !== activeChannelId) return;
      void ensureProfile(row.author_id);
      setMessages((current) => {
        if (current.some((m) => m.id === row.id)) return current;
        const tempIdx = current.findIndex(
          (m) =>
            m.id.startsWith("temp-") &&
            m.author_id === row.author_id &&
            m.body === row.body &&
            m.attachment_path === row.attachment_path,
        );
        if (tempIdx >= 0) {
          const next = [...current];
          next[tempIdx] = row;
          return next;
        }
        return [...current, row];
      });
    };

    const channel = supabase
      .channel(`rt-chat-${organizationId}`, {
        config: { broadcast: { self: false } },
      })
      .on("broadcast", { event: "new-message" }, (msg) => {
        const row = (msg as { payload?: ChatMessageView }).payload;
        if (row) ingestRow(row);
      })
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => ingestRow(payload.new as ChatMessageView),
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "chat_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const row = payload.new as ChatMessageView;
          setMessages((current) =>
            current.map((m) => (m.id === row.id ? { ...m, ...row } : m)),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "chat_messages",
          filter: `organization_id=eq.${organizationId}`,
        },
        (payload) => {
          const gone = (payload.old as { id?: string }).id;
          if (gone) setMessages((current) => current.filter((m) => m.id !== gone));
        },
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
  }, [organizationId, activeChannelId, ensureProfile]);

  const [sendError, setSendError] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Direct browser → Postgres send: one hop, no serverless detour. The row is
  // then broadcast over the websocket for ~RTT delivery on other screens;
  // postgres_changes and the polling backstop reconcile as fallbacks.
  const sendMessage = useCallback(
    async (
      chId: string,
      body: string,
      replyToId: string | null,
      attachmentPath: string | null,
      attachmentType: "image" | "video" | null,
      mentions: string[],
    ) => {
      const supabase = createClient();
      const { data: row, error } = await supabase.rpc("send_chat_message", {
        p_channel_id: chId,
        p_body: body,
        p_reply_to_id: replyToId,
        p_attachment_path: attachmentPath,
        p_attachment_type: attachmentType,
        p_mentions: mentions,
      });
      if (error || !row) {
        setMessages((current) =>
          current.filter(
            (m) =>
              !(
                m.id.startsWith("temp-") &&
                m.channel_id === chId &&
                m.body === body
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
    [],
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
        channel_id: activeChannelId,
        author_id: currentUserId,
        body: msg.body,
        edited_at: null,
        created_at: new Date().toISOString(),
        attachment_path: msg.attachmentPath,
        attachment_type: msg.attachmentType,
        attachment_name: msg.attachmentName,
        reply_to_id: msg.replyToId,
        mentions: [],
      },
    ]);
  }

  if (!activeChannel) {
    return (
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <div className="min-h-0">
          <ChannelSidebar
            slug={slug}
            organizationId={organizationId}
            channels={channels}
            activeSlug={null}
            canModerate={canModerate}
          />
        </div>
        <EmptyState
          icon={<Hash size={18} />}
          title="No channels yet"
          hint={
            canModerate
              ? "Create the first channel with the + button."
              : "Ask a moderator to create the first channel."
          }
        />
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
      <NewDmModal
        open={newDmOpen}
          onClose={() => setNewDmOpen(false)}
          slug={slug}
          organizationId={organizationId}
          members={members
            .filter((m) => m.user_id !== currentUserId)
            .map((m) => ({
              user_id: m.user_id,
              display_name: m.display_name,
              avatar_url: m.avatar_url,
            }))}
        />
      </div>
    );
  }

  const visible = messages.filter((m) => m.channel_id === activeChannel.id);
  const byId = new Map(visible.map((m) => [m.id, m]));

  return (
    <div className="grid min-h-0 gap-4 md:grid-cols-[200px_1fr]">
      <div className="min-h-0 md:overflow-y-auto">
        {/* Mobile: horizontal channel + DM chips (desktop rail owns DMs) */}
        <div className="flex gap-1 overflow-x-auto pb-1 md:hidden">
          {channels.map((ch) => (
            <a
              key={ch.id}
              href={`/o/${slug}/chat?c=${ch.slug}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                ch.slug === activeChannel.slug
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              # {ch.name}
            </a>
          ))}
          {dmThreads.map((t) => (
            <a
              key={t.id}
              href={`/o/${slug}/chat?dm=${t.id}`}
              className={`shrink-0 rounded-full border px-3 py-1 text-xs transition-colors ${
                activeDmId === t.id
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              @ {t.other_name}
            </a>
          ))}
          <button
            type="button"
            onClick={() => setNewDmOpen(true)}
            className="shrink-0 cursor-pointer rounded-full border border-dashed border-line-strong px-3 py-1 text-xs text-faint transition-colors hover:border-faint hover:text-ink"
          >
            + DM
          </button>
        </div>
        <div className="hidden md:block">
          <ChannelSidebar
            slug={slug}
            organizationId={organizationId}
            channels={channels}
            activeSlug={activeChannel.slug}
            canModerate={canModerate}
          />
        </div>
      </div>

      <section className="grid min-h-0 grid-rows-[auto_1fr_auto] overflow-hidden rounded-lg border border-line bg-panel">
        <header className="flex items-center border-b border-line px-4 py-2.5">
          <div className="min-w-0">
            <p className="flex items-baseline gap-2 text-sm font-medium">
              <span className="text-faint">#</span>
              {activeChannel.name}
            </p>
            {activeChannel.topic && (
              <p className="mt-0.5 text-xs text-faint">{activeChannel.topic}</p>
            )}
          </div>
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
          {visible.length === 0 ? (
            <EmptyState
              title={`Nothing in #${activeChannel.name} yet`}
              hint="It&apos;s quiet in here — break the ice."
            />
          ) : (
            <ul className="grid gap-0.5">
              {visible.map((m, i) => {
                const prev = visible[i - 1];
                const grouped =
                  prev !== undefined &&
                  prev.author_id === m.author_id &&
                  !m.reply_to_id &&
                  !m.id.startsWith("temp-") &&
                  !prev.id.startsWith("temp-") &&
                  new Date(m.created_at).getTime() -
                    new Date(prev.created_at).getTime() <
                    5 * 60_000;
                return (
                  <MessageRow
                    key={m.id}
                    message={m}
                    parentPreview={
                      m.reply_to_id
                        ? (() => {
                            const p = byId.get(m.reply_to_id!);
                            if (!p) return null;
                            return {
                              name: profiles[p.author_id]?.display_name ?? "member",
                              body: p.body || p.attachment_name || "attachment",
                            };
                          })()
                        : null
                    }
                    profile={profiles[m.author_id]}
                    grouped={grouped}
                    slug={slug}
                    memberNames={memberNames}
                    canEdit={m.author_id === currentUserId && !m.id.startsWith("temp-")}
                    canDelete={m.author_id === currentUserId || canModerate}
                    onReply={() => setReplyTo(m)}
                    editAction={editMessageAction}
                    deleteAction={deleteMessageAction}
                    online={online.has(m.author_id)}
                    isSelf={m.author_id === currentUserId}
                    onOpenProfile={() => setProfileUserId(m.author_id)}
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
                channelId={activeChannel.id}
                organizationId={organizationId}
                members={members}
                replyTo={replyTo}
                onCancelReply={() => setReplyTo(null)}
                onOptimistic={appendOptimistic}
                onSend={sendMessage}
              />
            </>
          ) : (
            <p className="rounded-md border border-dashed border-line px-3 py-2.5 text-center text-xs text-faint">
              You don&apos;t have permission to post in this workspace.
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
      <NewDmModal
        open={newDmOpen}
        onClose={() => setNewDmOpen(false)}
        slug={slug}
        organizationId={organizationId}
        members={members
          .filter((m) => m.user_id !== currentUserId)
          .map((m) => ({
            user_id: m.user_id,
            display_name: m.display_name,
            avatar_url: m.avatar_url,
          }))}
      />
    </div>
  );
}

export function MessageRow({
  message,
  parentPreview,
  profile,
  grouped,
  slug,
  memberNames,
  canEdit,
  canDelete,
  onReply,
  editAction,
  deleteAction,
  online = false,
  isSelf = false,
  onOpenProfile,
}: {
  message: ChatMessageView;
  parentPreview: { name: string; body: string } | null;
  profile?: ProfileInfo;
  grouped: boolean;
  slug: string;
  memberNames: string[];
  canEdit: boolean;
  canDelete: boolean;
  onReply: () => void;
  editAction: (fd: FormData) => void | Promise<void>;
  deleteAction: (fd: FormData) => void | Promise<void>;
  online?: boolean;
  isSelf?: boolean;
  onOpenProfile?: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const authorName = profile?.display_name ?? "member";

  return (
    <li className={`group relative rounded-md px-2 hover:bg-raised/60 ${grouped ? "" : "mt-3 pt-1"}`}>
      <div className="flex gap-3">
        {grouped ? (
          <span
            aria-hidden
            className="w-7 shrink-0 pt-0.5 text-right font-mono text-[9px] text-faint opacity-0 transition-opacity group-hover:opacity-100"
          >
            <time dateTime={message.created_at} suppressHydrationWarning>
              {fmtTime(message.created_at)}
            </time>
          </span>
        ) : (
          <button
            type="button"
            onClick={onOpenProfile}
            disabled={isSelf}
            title={isSelf ? undefined : "View profile"}
            className="relative shrink-0 cursor-pointer rounded-full disabled:cursor-default"
          >
            <Avatar name={authorName} url={profile?.avatar_url ?? undefined} size="sm" />
            <span
              aria-hidden
              className={`absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full border-2 border-panel ${
                online ? "bg-ok" : "bg-line-strong"
              }`}
            />
          </button>
        )}

        <div className="min-w-0 flex-1">
          {!grouped && (
            <p className="flex items-baseline gap-2">
              <button
                type="button"
                onClick={onOpenProfile}
                disabled={isSelf}
                title={isSelf ? undefined : "View profile"}
                className={`truncate text-sm font-medium disabled:cursor-default ${
                  isSelf ? "text-ink" : "cursor-pointer text-ink hover:text-accent hover:underline"
                }`}
              >
                {authorName}
              </button>
              <time
                dateTime={message.created_at}
                suppressHydrationWarning
                className="font-mono text-[10px] text-faint"
              >
                {fmtTime(message.created_at)}
              </time>
            </p>
          )}

          {parentPreview && (
            <div className="mb-1 flex max-w-lg items-center gap-1.5 rounded border border-line bg-raised/70 px-2 py-1 text-xs text-muted">
              <CornerUpLeft size={11} className="shrink-0 text-faint" />
              <span className="shrink-0 font-mono text-[10px] text-faint">
                {parentPreview.name}
              </span>
              <span className="truncate">{parentPreview.body}</span>
            </div>
          )}

          {editing ? (
            <EditForm
              message={message}
              slug={slug}
              editAction={editAction}
              onDone={() => setEditing(false)}
            />
          ) : (
            <>
              {message.body && (
                <p className="text-sm break-words whitespace-pre-wrap text-ink">
                  {renderBody(message.body, memberNames)}
                  {message.edited_at && (
                    <span className="ml-1.5 font-mono text-[10px] text-faint">
                      (edited)
                    </span>
                  )}
                </p>
              )}
              {message.attachment_path && message.attachment_type ? (
                message.id.startsWith("temp-") ? (
                  <p className="mt-1 font-mono text-[10px] text-faint">
                    uploading {message.attachment_name}…
                  </p>
                ) : (
                  <div className="mt-1.5">
                    <ChatAttachment
                      path={message.attachment_path}
                      type={message.attachment_type}
                      name={message.attachment_name}
                    />
                  </div>
                )
              ) : null}
            </>
          )}
        </div>

        <div className="absolute top-0.5 right-2 hidden items-center gap-1 group-hover:flex">
          <button
            type="button"
            onClick={onReply}
            title="Reply"
            aria-label="Reply to message"
            className="cursor-pointer rounded bg-panel p-1 text-faint hover:text-accent"
          >
            <CornerUpLeft size={12} />
          </button>
          {canEdit && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              title="Edit message"
              aria-label="Edit message"
              className="cursor-pointer rounded bg-panel p-1 text-faint hover:text-ink"
            >
              <Pencil size={12} />
            </button>
          )}
          {canDelete && (
            <form action={deleteAction}>
              <input type="hidden" name="message_id" value={message.id} />
              <input type="hidden" name="slug" value={slug} />
              <DangerButton label="DEL" confirmLabel="SURE?" />
            </form>
          )}
        </div>
      </div>
    </li>
  );
}

export function EditForm({
  message,
  slug,
  editAction,
  onDone,
}: {
  message: ChatMessageView;
  slug: string;
  editAction: (fd: FormData) => void | Promise<void>;
  onDone: () => void;
}) {
  return (
    <form
      action={(fd) => {
        void editAction(fd);
        onDone();
      }}
      className="my-1 grid gap-1.5"
    >
      <input type="hidden" name="message_id" value={message.id} />
      <input type="hidden" name="slug" value={slug} />
      <textarea
        name="body"
        rows={2}
        required
        maxLength={2000}
        defaultValue={message.body}
        aria-label="Edit message"
        className="resize-none"
        autoFocus
      />
      <div className="flex justify-end gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm">
          Save
        </Button>
      </div>
    </form>
  );
}

export function Composer({
  channelId,
  organizationId,
  members,
  replyTo,
  onCancelReply,
  onOptimistic,
  onSend,
}: {
  channelId: string;
  organizationId: string;
  members: ChatMember[];
  replyTo: ChatMessageView | null;
  onCancelReply: () => void;
  onOptimistic: (msg: {
    body: string;
    attachmentPath: string | null;
    attachmentType: "image" | "video" | null;
    attachmentName: string | null;
    replyToId: string | null;
  }) => void;
  onSend: (
    chId: string,
    body: string,
    replyToId: string | null,
    attachmentPath: string | null,
    attachmentType: "image" | "video" | null,
    mentions: string[],
  ) => Promise<boolean>;
}) {
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const mentionsRef = useRef(new Map<string, string>());

  const mentionMatches = mention
    ? members
        .filter((m) => m.display_name.toLowerCase().includes(mention.query.toLowerCase()))
        .slice(0, 5)
    : [];

  function updateMentionQuery(value: string, caret: number | null) {
    const upto = value.slice(0, caret ?? value.length);
    const match = upto.match(/@([\w .-]*)$/);
    setMention(
      match
        ? { start: upto.length - match[0].length, query: match[1] ?? "" }
        : null,
    );
  }

  function pickMention(member: ChatMember) {
    if (!mention) return;
    const caret = draft.length;
    const before = draft.slice(0, mention.start);
    const after = draft.slice(caret);
    setDraft(`${before}@${member.display_name} ${after}`);
    mentionsRef.current.set(member.user_id, member.display_name);
    setMention(null);
  }

  function insertEmoji(emoji: string) {
    setDraft((d) => d + emoji);
  }

  async function handleSend() {
    if (pending) return;
    const body = draft.trim();
    if (!body && !file) return;
    setError(null);
    setPending(true);
    try {
      let attachmentPath: string | null = null;
      let attachmentType: "image" | "video" | null = null;

      if (file) {
        if (file.size > MAX_ATTACHMENT_BYTES) {
          setError("Attachments are capped at 5MB.");
          setPending(false);
          return;
        }
        const ext = file.name.includes(".") ? file.name.split(".").pop() : "bin";
        attachmentPath = `${organizationId}/${channelId}/${crypto.randomUUID()}.${ext}`;
        const supabase = createClient();
        const { error: upErr } = await supabase.storage
          .from("chat-attachments")
          .upload(attachmentPath, file, { contentType: file.type });
        if (upErr) throw upErr;
        attachmentType = file.type.startsWith("video") ? "video" : "image";
      }

      // Mentioned = explicitly picked + anyone typed as @Name.
      const mentioned = new Map(mentionsRef.current);
      for (const m of members) {
        if (body.includes(`@${m.display_name}`)) {
          mentioned.set(m.user_id, m.display_name);
        }
      }

      onOptimistic({
        body,
        attachmentPath,
        attachmentType,
        attachmentName: file?.name ?? null,
        replyToId: replyTo?.id ?? null,
      });
      setDraft("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      mentionsRef.current.clear();
      onCancelReply();

      const ok = await onSend(
        channelId,
        body,
        replyTo?.id ?? null,
        attachmentPath,
        attachmentType,
        [...mentioned.keys()],
      );
      if (!ok) setError("Couldn't send — check your connection and retry.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-1.5">
      {replyTo && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-raised/70 px-2.5 py-1.5 text-xs text-muted">
          <CornerUpLeft size={12} className="shrink-0 text-faint" />
          <span className="truncate">
            Replying to <span className="font-medium text-ink">{replyTo.body || replyTo.attachment_name || "attachment"}</span>
          </span>
          <button
            type="button"
            onClick={onCancelReply}
            aria-label="Cancel reply"
            className="ml-auto cursor-pointer rounded p-0.5 text-faint hover:text-ink"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {file && (
        <div className="flex items-center gap-2 rounded-md border border-line bg-raised/70 px-2.5 py-1.5 text-xs text-muted">
          <Paperclip size={12} className="shrink-0 text-faint" />
          <span className="truncate">{file.name}</span>
          <span className="shrink-0 font-mono text-[10px] text-faint">
            {(file.size / (1024 * 1024)).toFixed(1)}MB
          </span>
          <button
            type="button"
            onClick={() => {
              setFile(null);
              if (fileRef.current) fileRef.current.value = "";
            }}
            aria-label="Remove attachment"
            className="ml-auto cursor-pointer rounded p-0.5 text-faint hover:text-err"
          >
            <X size={12} />
          </button>
        </div>
      )}

      <div className="relative flex items-end gap-2">
        {mentionMatches.length > 0 && mention && (
          <div className="absolute bottom-full left-0 z-30 mb-1 w-64 overflow-hidden rounded-md border border-line-strong bg-overlay shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            {mentionMatches.map((m) => (
              <button
                key={m.user_id}
                type="button"
                onClick={() => pickMention(m)}
                className="flex w-full cursor-pointer items-center gap-2 px-2.5 py-1.5 text-left text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
              >
                <Avatar name={m.display_name} size="sm" />
                @{m.display_name}
              </button>
            ))}
          </div>
        )}

        {emojiOpen && (
          <div className="absolute bottom-full left-8 z-30 mb-1 grid w-56 grid-cols-8 gap-0.5 rounded-md border border-line-strong bg-overlay p-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.45)]">
            {EMOJIS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => insertEmoji(e)}
                className="cursor-pointer rounded p-0.5 text-lg transition-colors hover:bg-raised"
              >
                {e}
              </button>
            ))}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] ?? null;
            if (f && f.size > MAX_ATTACHMENT_BYTES) {
              setError("Attachments are capped at 5MB.");
              e.target.value = "";
              return;
            }
            setError(null);
            setFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="Attach image or video (max 5MB)"
          aria-label="Attach image or video"
          className="cursor-pointer rounded-md border border-line p-2 text-muted transition-colors hover:border-faint hover:text-ink"
        >
          <ImagePlus size={15} />
        </button>

        <div className="relative flex-1">
          <textarea
            rows={1}
            maxLength={2000}
            value={draft}
            placeholder="Message the room… use @ to ping, attach media, emoji welcome"
            aria-label="New message"
            className="max-h-40 min-h-9 w-full resize-none pr-9"
            onChange={(e) => {
              setDraft(e.target.value);
              updateMentionQuery(e.target.value, e.target.selectionStart);
            }}
            onKeyDown={(e) => {
              if (mentionMatches.length > 0 && e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                pickMention(mentionMatches[0]);
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
          />
          <button
            type="button"
            onClick={() => setEmojiOpen((v) => !v)}
            title="Emoji"
            aria-label="Insert emoji"
            className="absolute top-1/2 right-1.5 -translate-y-1/2 cursor-pointer rounded p-1 text-faint transition-colors hover:text-ink"
          >
            <Smile size={15} />
          </button>
        </div>

        <Button
          type="button"
          size="md"
          loading={pending}
          onClick={() => void handleSend()}
          aria-label="Send message"
        >
          {!pending && <SendHorizonal size={15} />}
        </Button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
    </div>
  );
}

function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}
