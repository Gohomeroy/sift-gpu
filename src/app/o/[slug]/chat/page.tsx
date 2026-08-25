import type { Metadata } from "next";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { ChatRoom } from "./chat-room";
import { DmRoom, type DmMessageView, type DmThreadView } from "./dm-room";
import type { ChatChannel, ChatMessage } from "@/lib/types";

type DmMessageRow = DmMessageView & { organization_id: string };

export const metadata: Metadata = { title: "Chat" };

export default async function ChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ c?: string; dm?: string }>;
}) {
  const { slug } = await params;
  const { c, dm } = await searchParams;
  const { org, member, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const { data: channels } = await supabase
    .from("chat_channels")
    .select("*")
    .eq("organization_id", org.id)
    .order("created_at");

  const channelRows = (channels ?? []) as unknown as ChatChannel[];

  // DM threads for this user in this org, with the other member's identity.
  const { data: threadRows } = await supabase
    .from("dm_threads")
    .select("*")
    .eq("organization_id", org.id)
    .order("created_at");
  const myThreads = (threadRows ?? []).filter(
    (t) => t.user_a_id === member.user_id || t.user_b_id === member.user_id,
  );
  const otherIds = [
    ...new Set(
      myThreads.map((t) =>
        t.user_a_id === member.user_id ? t.user_b_id : t.user_a_id,
      ),
    ),
  ];
  const { data: threadPeople } =
    otherIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", otherIds)
      : { data: [] };
  const threadPeopleMap = new Map(
    (threadPeople ?? []).map((p) => [p.id, p]),
  );
  const dmThreads: DmThreadView[] = myThreads.map((t) => {
    const otherId =
      t.user_a_id === member.user_id ? t.user_b_id : t.user_a_id;
    const person = threadPeopleMap.get(otherId);
    return {
      id: t.id,
      other_name: person?.display_name ?? "member",
      other_avatar: person?.avatar_url ?? null,
    };
  });

  // Members power @mention autocomplete + the new-DM picker.
  const { data: memberRows } = await supabase
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", org.id)
    .eq("status", "active");
  const memberIds = (memberRows ?? []).map((m) => m.user_id);
  const { data: memberPeople } =
    memberIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", memberIds)
      : { data: [] as { id: string; display_name: string; avatar_url: string | null }[] };
  const pickable = (memberPeople ?? [])
    .map((p) => ({
      user_id: p.id,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
  const chatMembers = pickable.map((p) => ({
    user_id: p.user_id,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
  }));

  const canSend = can(permissions, "send_chat");
  const canModerate = can(permissions, "moderate_chat");

  // ---- DM mode ------------------------------------------------------------
  const activeThread = dm ? myThreads.find((t) => t.id === dm) ?? null : null;
  if (activeThread) {
    const otherId =
      activeThread.user_a_id === member.user_id
        ? activeThread.user_b_id
        : activeThread.user_a_id;
    const otherPerson = threadPeopleMap.get(otherId);

    const { data: dmMessages } = await supabase
      .from("dm_messages")
      .select("*")
      .eq("thread_id", activeThread.id)
      .order("created_at", { ascending: false })
      .limit(100);

    const dmRows = ((dmMessages ?? []) as unknown as DmMessageRow[])
      .slice()
      .reverse();

    return (
      <div className="mx-auto grid h-[calc(100dvh-3rem)] max-w-6xl grid-rows-[auto_1fr] gap-4 md:h-[calc(100dvh-4rem)]">
        <header>
          <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
          <p className="mt-0.5 text-sm text-muted">
            The room where the work gets talked about.
          </p>
        </header>

        <DmRoom
          slug={slug}
          organizationId={org.id}
          channels={channelRows}
          canModerate={canModerate}
          threads={dmThreads}
          members={pickable}
          activeThread={{
            id: activeThread.id,
            other_name: otherPerson?.display_name ?? "member",
            other_avatar: otherPerson?.avatar_url ?? null,
          }}
          otherUserId={otherId}
          otherUser={
            otherPerson
              ? {
                  display_name: otherPerson.display_name,
                  avatar_url: otherPerson.avatar_url,
                }
              : null
          }
          initialMessages={dmRows}
          currentUserId={member.user_id}
          canSend={canSend}
        />
      </div>
    );
  }

  // ---- Channel mode -------------------------------------------------------
  const active = channelRows.find((ch) => ch.slug === c) ?? channelRows[0] ?? null;

  const { data: messages } = active
    ? await supabase
        .from("chat_messages")
        .select("*")
        .eq("channel_id", active.id)
        .order("created_at", { ascending: false })
        .limit(100)
    : { data: [] };

  // author_id points at auth.users, not profiles — no embeddable FK, so
  // authors are batch-resolved the same way as the members page.
  const messageRows = ((messages ?? []) as unknown as ChatMessage[])
    .slice()
    .reverse();
  const authorIds = [...new Set(messageRows.map((m) => m.author_id))];
  const { data: people } =
    authorIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", authorIds)
      : { data: [] };
  const initialProfiles: Record<string, { display_name: string; avatar_url: string | null }> =
    Object.fromEntries(
      (people ?? []).map((p) => [
        p.id,
        { display_name: p.display_name, avatar_url: p.avatar_url },
      ]),
    );

  return (
    <div className="mx-auto grid h-[calc(100dvh-3rem)] max-w-6xl grid-rows-[auto_1fr] gap-4 md:h-[calc(100dvh-4rem)]">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Chat</h1>
        <p className="mt-0.5 text-sm text-muted">
          The room where the work gets talked about.
        </p>
      </header>

      <ChatRoom
        slug={slug}
        organizationId={org.id}
        channels={channelRows}
        activeChannel={active}
        initialMessages={messageRows}
        initialProfiles={initialProfiles}
        members={chatMembers}
        dmThreads={dmThreads}
        currentUserId={member.user_id}
        canSend={canSend}
        canModerate={canModerate}
      />
    </div>
  );
}
