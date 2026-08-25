import Link from "next/link";
import { requireOrgContext, getUserOrganizations, getSessionUser } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { OrgNav, UserBlock, SidebarTop } from "@/components/org-nav";
import { OrgSwitcher } from "@/components/org-switcher";
import { NotificationBell, type NotificationView } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { Alert } from "@/components/ui/alert";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const ctx = await requireOrgContext(slug);
  const [orgs, user] = await Promise.all([
    getUserOrganizations(),
    getSessionUser(),
  ]);

  const supabase = await createClient();
  const [
    { data: profile },
    { data: isPlatformAdmin },
    { data: notifications },
    { data: dmThreadRows },
    { data: railMemberRows },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("display_name, avatar_url")
      .eq("id", user!.id)
      .single(),
    supabase.rpc("is_platform_admin"),
    supabase
      .from("notifications")
      .select("*")
      .eq("organization_id", ctx.org.id)
      .eq("user_id", user!.id)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("dm_threads")
      .select("*")
      .eq("organization_id", ctx.org.id)
      .order("created_at"),
    supabase
      .from("organization_members")
      .select("user_id")
      .eq("organization_id", ctx.org.id)
      .eq("status", "active"),
  ]);

  // My DM threads + the other side's identity, for the workspace rail.
  const myThreads = (dmThreadRows ?? []).filter(
    (t) => t.user_a_id === user!.id || t.user_b_id === user!.id,
  );
  const otherIds = [
    ...new Set(
      myThreads.map((t) =>
        t.user_a_id === user!.id ? t.user_b_id : t.user_a_id,
      ),
    ),
  ];
  const { data: dmPeople } =
    otherIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", otherIds)
      : { data: [] };
  const dmPersonById = new Map((dmPeople ?? []).map((p) => [p.id, p]));
  const dmThreadsForRail = myThreads.map((t) => {
    const otherId =
      t.user_a_id === user!.id ? t.user_b_id : t.user_a_id;
    const person = dmPersonById.get(otherId);
    return {
      id: t.id as string,
      other_name: (person?.display_name as string | undefined) ?? "member",
      other_avatar: (person?.avatar_url as string | null | undefined) ?? null,
    };
  });

  // Pickable members for the rail's new-DM picker.
  const railMemberIds = (railMemberRows ?? []).map((m) => m.user_id as string);
  const { data: railMemberProfiles } =
    railMemberIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, display_name, avatar_url")
          .in("id", railMemberIds)
      : { data: [] };
  const membersForRail = (railMemberProfiles ?? [])
    .map((p) => ({
      user_id: p.id,
      display_name: p.display_name as string,
      avatar_url: (p.avatar_url as string | null | undefined) ?? null,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const notificationRows = (notifications ?? []) as unknown as NotificationView[];
  const unread = notificationRows.filter((n) => !n.read_at).length;

  const switcherOrgs = orgs.map((o) => ({ id: o.id, name: o.name, slug: o.slug }));
  const current = { id: ctx.org.id, name: ctx.org.name, slug: ctx.org.slug };

  const permsForNav = new Set<string>(ctx.permissions);

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-4 border-r border-line bg-panel px-3 py-4 md:flex">
        <SidebarTop current={current} orgs={switcherOrgs} />
        <div className="min-h-0 flex-1 overflow-y-auto">
          <OrgNav
            slug={slug}
            permissions={permsForNav}
            dmThreads={dmThreadsForRail}
            organizationId={ctx.org.id}
            members={membersForRail}
          />
        </div>
        <NotificationBell
          slug={slug}
          organizationId={ctx.org.id}
          userId={user!.id}
          notifications={notificationRows}
          unread={unread}
        />
        {isPlatformAdmin && (
          <Link
            href="/admin"
            className="rounded-md border border-line px-3 py-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase transition-colors hover:border-faint hover:text-accent"
          >
            Platform console →
          </Link>
        )}
        <UserBlock
          name={profile?.display_name ?? "Member"}
          email={user!.email ?? ""}
          avatarUrl={profile?.avatar_url ?? null}
          isOwner={ctx.org.owner_id === user!.id}
        />
      </aside>

      {/* Mobile top bar */}
      <header className="border-b border-line bg-panel px-4 py-3 md:hidden">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-mono text-sm font-medium tracking-widest">
            SIFT<span className="sift-tick" aria-hidden />
          </span>
          <div className="flex items-center gap-1">
            <Link href="/profile" className="font-mono text-[11px] text-muted hover:text-accent">
              {profile?.display_name ?? "You"} · profile →
            </Link>
            <ThemeToggle />
          </div>
        </div>
        <OrgSwitcher current={current} orgs={switcherOrgs} />
        <div className="mt-2 -mx-1">
          <OrgNav
            slug={slug}
            permissions={permsForNav}
            dmThreads={dmThreadsForRail}
            organizationId={ctx.org.id}
            members={membersForRail}
          />
        </div>
      </header>

      <main className="min-w-0 flex-1 px-5 py-6 sm:px-8">
        {ctx.org.status === "suspended" && (
          <Alert kind="error" className="mb-6">
            This workspace has been suspended by SIFT. Content is read-only.
          </Alert>
        )}
        {children}
      </main>
    </div>
  );
}
