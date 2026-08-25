import type { Metadata } from "next";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { leaveOrganizationAction } from "@/app/actions/orgs";
import { DangerButton } from "@/components/ui/danger-button";
import { EmptyState } from "@/components/ui/empty";
import { MemberList } from "./member-list";
import type { Role } from "@/lib/types";

export const metadata: Metadata = { title: "Members" };

type RoleLite = Pick<Role, "id" | "name" | "color">;

export default async function MembersPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, member, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const [{ data: members }, { data: roles }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("*")
      .eq("organization_id", org.id)
      .order("joined_at"),
    supabase
      .from("roles")
      .select("id, name, color")
      .eq("organization_id", org.id)
      .order("position"),
  ]);

  const ids = (members ?? []).map((m) => m.user_id);
  const memberIds = (members ?? []).map((m) => m.id);

  const [profileRes, mrRes, reviewRes, completedRes] = await Promise.all([
    ids.length
      ? supabase.from("profiles").select("id, display_name, avatar_url").in("id", ids)
      : Promise.resolve({ data: [] as never[] }),
    memberIds.length
      ? supabase
          .from("member_roles")
          .select("organization_member_id, role_id")
          .in("organization_member_id", memberIds)
      : Promise.resolve({ data: [] as never[] }),
    supabase.from("reviews").select("editor_id, rating").eq("organization_id", org.id),
    supabase
      .from("submissions")
      .select("editor_id")
      .eq("organization_id", org.id)
      .eq("status", "approved"),
  ]);

  // Per-org reputation is DERIVED — average rating, review count, completed
  // jobs — never stored on the global profile.
  const reputation: Record<
    string,
    { avg: number | null; reviews: number; completed: number }
  > = {};
  for (const r of reviewRes.data ?? []) {
    const cur = reputation[r.editor_id] ?? { avg: null, reviews: 0, completed: 0 };
    const total = cur.avg === null ? r.rating : cur.avg * cur.reviews + r.rating;
    cur.reviews += 1;
    cur.avg = total / cur.reviews;
    reputation[r.editor_id] = cur;
  }
  for (const s of completedRes.data ?? []) {
    const cur = reputation[s.editor_id] ?? { avg: null, reviews: 0, completed: 0 };
    cur.completed += 1;
    reputation[s.editor_id] = cur;
  }

  const profileMap = new Map(
    (profileRes.data ?? []).map((p) => [p.id, p]),
  );
  const roleById = new Map((roles ?? []).map((r) => [r.id, r]));
  const rolesByMember = new Map<string, RoleLite[]>();
  for (const mr of mrRes.data ?? []) {
    const r = roleById.get(mr.role_id);
    if (!r) continue;
    const list = rolesByMember.get(mr.organization_member_id) ?? [];
    list.push({ id: r.id, name: r.name, color: r.color });
    rolesByMember.set(mr.organization_member_id, list);
  }

  const rows = (members ?? []).map((m) => ({
    ...m,
    profiles: profileMap.get(m.user_id) ?? null,
    roles: rolesByMember.get(m.id) ?? [],
    reputation: reputation[m.user_id] ?? null,
  }));

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Members</h1>
        <p className="mt-0.5 text-sm text-muted">
          Everyone with access to this workspace.
        </p>
      </header>

      <MemberList
        rows={rows}
        allRoles={(roles ?? []) as RoleLite[]}
        currentUserId={member.user_id}
        ownerId={org.owner_id}
        canKick={can(permissions, "kick_users")}
        canBan={can(permissions, "ban_users")}
        canManageRoles={can(permissions, "manage_roles")}
        canSend={can(permissions, "send_chat")}
        slug={slug}
        organizationId={org.id}
      />

      <section className="rounded-lg border border-line bg-panel px-4 py-3">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Your membership
        </h2>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            Leaving removes your roles here. You can rejoin later with a fresh
            invite.
          </p>
          {org.owner_id === member.user_id ? (
            <span className="font-mono text-[11px] text-faint">
              Owners can&apos;t leave their own workspace
            </span>
          ) : (
            <form action={leaveOrganizationAction}>
              <input type="hidden" name="organization_id" value={org.id} />
              <DangerButton label="LEAVE WORKSPACE" confirmLabel="CONFIRM LEAVE?" />
            </form>
          )}
        </div>
      </section>

      {(members ?? []).length <= 1 && (
        <EmptyState
          title="It's just you so far"
          hint="Invite editors from the Invites tab — each invite carries the role they'll join with."
        />
      )}
    </div>
  );
}
