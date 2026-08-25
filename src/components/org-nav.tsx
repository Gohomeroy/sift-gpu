"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  UserPlus,
  Settings,
  Briefcase,
  MessagesSquare,
  Megaphone,
  Sparkles,
  Clapperboard,
  MessageSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissions";
import { signOutAction } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { OrgSwitcher, type SwitcherOrg } from "./org-switcher";
import { NewDmModal } from "@/app/o/[slug]/chat/dm-room";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  permission?: PermissionKey;
};

export type RailDmThread = {
  id: string;
  other_name: string;
  other_avatar: string | null;
};

type PickableMember = {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
};

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/clipper", label: "AI Clipper", icon: Sparkles },
  { href: "/studio", label: "Studio", icon: Clapperboard },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/members", label: "Members", icon: Users },
  { href: "/roles", label: "Roles", icon: ShieldCheck, permission: "access_admin_panel" },
  { href: "/invites", label: "Invites", icon: UserPlus, permission: "manage_roles" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "access_admin_panel" },
];

export function OrgNav({
  slug,
  permissions,
  dmThreads,
  organizationId,
  members = [],
}: {
  slug: string;
  permissions: Set<string>;
  dmThreads?: RailDmThread[];
  organizationId?: string;
  members?: PickableMember[];
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const perms = permissions as Set<PermissionKey>;
  const [newDmOpen, setNewDmOpen] = useState(false);

  const items = NAV.filter((n) => !n.permission || can(perms, n.permission));
  const chatBase = `/o/${slug}/chat`;
  const onChat = pathname.startsWith(chatBase);
  const activeDm = searchParams.get("dm");
  // The rail owns DMs; inside the Chat tab itself they'd duplicate it.
  const showDms = dmThreads !== undefined;

  return (
    <nav className="flex gap-1 overflow-x-auto md:flex-col">
      {items.map((item) => {
        const href = `/o/${slug}${item.href}`;
        const active =
          item.href === ""
            ? pathname === href
            : pathname.startsWith(href);
        return (
          <Link
            key={item.href}
            href={href}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-150",
              active
                ? "bg-raised font-medium text-accent"
                : "text-muted hover:bg-raised hover:text-ink",
            )}
          >
            <item.icon size={15} />
            {item.label}
          </Link>
        );
      })}

      {showDms && (
        <div className="mt-3 hidden min-w-0 shrink-0 flex-col gap-1 border-t border-line pt-3 md:flex">
          <div className="flex items-center justify-between px-2">
            <h2 className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Direct messages
            </h2>
            <button
              type="button"
              onClick={() => setNewDmOpen(true)}
              title="New direct message"
              aria-label="New direct message"
              className="cursor-pointer rounded p-0.5 text-faint transition-colors hover:bg-raised hover:text-ink"
            >
              <MessageSquare size={14} />
            </button>
          </div>
          {dmThreads.length === 0 ? (
            <p className="hidden px-3 py-1 text-xs text-faint md:block">
              None yet
            </p>
          ) : (
            dmThreads.map((t) => (
              <a
                key={t.id}
                href={`${chatBase}?dm=${t.id}`}
                className={cn(
                  "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
                  onChat && activeDm === t.id
                    ? "bg-raised font-medium text-accent"
                    : "text-muted hover:bg-raised hover:text-ink",
                )}
              >
                <Avatar name={t.other_name} url={t.other_avatar ?? undefined} size="sm" />
                <span className="truncate">{t.other_name}</span>
              </a>
            ))
          )}
        </div>
      )}

      {showDms && organizationId && (
        <NewDmModal
          open={newDmOpen}
          onClose={() => setNewDmOpen(false)}
          slug={slug}
          organizationId={organizationId}
          members={members.filter((m) => m.user_id !== undefined)}
        />
      )}
    </nav>
  );
}

export function UserBlock({
  name,
  email,
  avatarUrl,
  isOwner,
}: {
  name: string;
  email: string;
  avatarUrl: string | null;
  isOwner: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 border-t border-line pt-3">
      <Link
        href="/profile"
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md p-1 transition-colors hover:bg-raised"
        title="Your profile"
      >
        <Avatar name={name} url={avatarUrl} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-xs font-medium">{name}</span>
          <span className="block truncate font-mono text-[10px] text-faint">
            {isOwner ? "OWNER" : email}
          </span>
        </span>
      </Link>
      <div className="flex items-center gap-0.5">
        <ThemeToggle />
        <form action={signOutAction}>
          <button
            type="submit"
            title="Sign out"
            className="cursor-pointer rounded-md px-2 py-2 font-mono text-[11px] text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            ⏻
          </button>
        </form>
      </div>
    </div>
  );
}

export function SidebarTop({
  current,
  orgs,
}: {
  current: SwitcherOrg;
  orgs: SwitcherOrg[];
}) {
  return (
    <>
      <Link
        href="/"
        className="font-mono text-sm font-medium tracking-widest"
      >
        SIFT<span className="sift-tick" aria-hidden />
      </Link>
      <div className="mt-4">
        <OrgSwitcher current={current} orgs={orgs} />
      </div>
    </>
  );
}
