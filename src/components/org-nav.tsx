"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { can } from "@/lib/permissions";
import type { PermissionKey } from "@/lib/permissions";
import { signOutAction } from "@/app/actions/auth";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "./theme-toggle";
import { OrgSwitcher, type SwitcherOrg } from "./org-switcher";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number | string; className?: string }>;
  permission?: PermissionKey;
};

const NAV: NavItem[] = [
  { href: "", label: "Overview", icon: LayoutDashboard },
  { href: "/jobs", label: "Jobs", icon: Briefcase },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/clipper", label: "AI Clipper", icon: Sparkles },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/members", label: "Members", icon: Users },
  { href: "/roles", label: "Roles", icon: ShieldCheck, permission: "access_admin_panel" },
  { href: "/invites", label: "Invites", icon: UserPlus, permission: "manage_roles" },
  { href: "/settings", label: "Settings", icon: Settings, permission: "access_admin_panel" },
];

export function OrgNav({
  slug,
  permissions,
}: {
  slug: string;
  permissions: Set<string>;
}) {
  const pathname = usePathname();
  const perms = permissions as Set<PermissionKey>;

  const items = NAV.filter((n) => !n.permission || can(perms, n.permission));

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
