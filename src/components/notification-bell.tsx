"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { markAllNotificationsReadAction } from "@/app/actions/notifications";
import { timeAgo } from "@/lib/utils";
import { EmptyState } from "@/components/ui/empty";

export type NotificationView = {
  id: string;
  organization_id: string;
  user_id: string;
  type: string;
  payload: {
    job_id?: string;
    submission_id?: string;
    title?: string;
    version_number?: number;
    revision_count?: number;
    channel_name?: string;
    channel_slug?: string;
    author_name?: string;
    thread_id?: string;
  };
  read_at: string | null;
  created_at: string;
};

function itemText(n: NotificationView): { text: string; href: string | null } {
  switch (n.type) {
    case "job_assigned":
      return {
        text: `You were assigned “${n.payload.title ?? "a job"}”`,
        href: n.payload.job_id ? `/jobs/${n.payload.job_id}` : null,
      };
    case "submission_delivered":
      return {
        text: `New v${n.payload.version_number ?? "?"} on “${n.payload.title ?? "your job"}”`,
        href: n.payload.submission_id
          ? `/submissions/${n.payload.submission_id}`
          : null,
      };
    case "revision_requested":
      return {
        text: `Revision requested${n.payload.revision_count ? ` (#${n.payload.revision_count})` : ""}`,
        href: n.payload.submission_id
          ? `/submissions/${n.payload.submission_id}`
          : null,
      };
    case "submission_approved":
      return {
        text: "Your work was approved",
        href: n.payload.submission_id
          ? `/submissions/${n.payload.submission_id}`
          : null,
      };
    case "chat_mention":
      return {
        text: `${n.payload.author_name ?? "Someone"} pinged you in #${n.payload.channel_name ?? "chat"}`,
        href: n.payload.channel_slug ? `/chat?c=${n.payload.channel_slug}` : "/chat",
      };
    case "chat_dm":
      return {
        text: `${n.payload.author_name ?? "Someone"} sent you a message`,
        href: n.payload.thread_id ? `/chat?dm=${n.payload.thread_id}` : "/chat",
      };
    default:
      return { text: n.type, href: null };
  }
}

export function NotificationBell({
  slug,
  organizationId,
  userId,
  notifications,
  unread,
}: {
  slug: string;
  organizationId: string;
  userId: string;
  notifications: NotificationView[];
  unread: number;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`rt-notifications-${organizationId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => router.refresh(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [organizationId, userId, router]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` — ${unread} unread` : ""}`}
        className="relative flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-raised hover:text-ink"
      >
        <Bell size={15} />
        <span className="hidden md:inline">Notifications</span>
        {unread > 0 && (
          <span className="ml-auto grid size-4.5 min-w-4.5 place-items-center rounded-full bg-accent px-1 font-mono text-[9px] font-medium text-on-accent">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute bottom-full left-0 z-40 mb-2 w-80 overflow-hidden rounded-lg border border-line-strong bg-panel shadow-[0_16px_48px_rgba(0,0,0,0.5)] max-md:fixed max-md:inset-x-4 max-md:bottom-16 max-md:w-auto">
          <header className="flex items-center justify-between border-b border-line px-3 py-2">
            <h2 className="font-mono text-[10px] tracking-[0.08em] text-muted uppercase">
              Notifications
            </h2>
            {unread > 0 && (
              <form action={markAllNotificationsReadAction}>
                <input type="hidden" name="organization_id" value={organizationId} />
                <input type="hidden" name="slug" value={slug} />
                <button
                  type="submit"
                  className="inline-flex cursor-pointer items-center gap-1 font-mono text-[10px] text-faint uppercase transition-colors hover:text-accent"
                >
                  <CheckCheck size={11} /> mark all read
                </button>
              </form>
            )}
          </header>

          {notifications.length === 0 ? (
            <div className="p-2">
              <EmptyState
                title="Nothing yet"
                hint="Assignments, deliveries and approvals land here."
              />
            </div>
          ) : (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto">
              {notifications.map((n) => {
                const { text, href } = itemText(n);
                const inner = (
                  <span className="block px-3 py-2.5">
                    <span className="flex items-start justify-between gap-2">
                      <span
                        className={`text-sm ${n.read_at ? "text-muted" : "font-medium text-ink"}`}
                      >
                        {text}
                      </span>
                      {!n.read_at && (
                        <span
                          aria-hidden
                          className="mt-1.5 size-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                    </span>
                    <span className="mt-0.5 block font-mono text-[10px] text-faint">
                      {timeAgo(n.created_at)}
                    </span>
                  </span>
                );
                return (
                  <li key={n.id}>
                    {href ? (
                      <a
                        href={`/o/${slug}${href}`}
                        onClick={() => setOpen(false)}
                        className="block transition-colors hover:bg-raised"
                      >
                        {inner}
                      </a>
                    ) : (
                      inner
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
