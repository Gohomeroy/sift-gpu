import Link from "next/link";
import { Briefcase, UserPlus, ShieldCheck } from "lucide-react";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Chip } from "@/components/ui/chip";
import { timeAgo } from "@/lib/utils";
import type { AuditEntry } from "@/lib/types";

export default async function OrgOverview({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, permissions, roles, member } = await requireOrgContext(slug);
  const supabase = await createClient();

  const [{ count: memberCount }, { data: myRoles }] = await Promise.all([
    supabase
      .from("organization_members")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", org.id),
    supabase
      .from("member_roles")
      .select("roles(name, color)")
      .eq("organization_member_id", member.id),
  ]);

  const myRoleChips = ((myRoles ?? []) as unknown as {
    roles: { name: string; color: string } | null;
  }[])

  const showInvites = can(permissions, "manage_roles");
  const [{ count: inviteCount }] = showInvites
    ? await Promise.all([
        supabase
          .from("organization_invites")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", org.id),
      ])
    : [{}];

  const showAdmin = can(permissions, "access_admin_panel");
  let audit: (AuditEntry & {
    actor_name?: string | null;
    target_name?: string | null;
  })[] = [];

  if (showAdmin) {
    const { data: rows } = await supabase
      .from("audit_log")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false })
      .limit(8);
    audit = rows ?? [];

    const ids = [
      ...new Set(
        audit.flatMap((a) => [a.actor_id, a.target_user_id].filter(Boolean)),
      ),
    ];
    if (ids.length > 0) {
      const { data: people } = await supabase
        .from("profiles")
        .select("id, display_name")
        .in("id", ids);
      const names = new Map((people ?? []).map((p) => [p.id, p.display_name]));
      audit = audit.map((a) => ({
        ...a,
        actor_name: a.actor_id ? names.get(a.actor_id) ?? null : null,
        target_name: a.target_user_id ? names.get(a.target_user_id) ?? null : null,
      }));
    }
  }

  const fresh = (memberCount ?? 0) <= 1 && !showInvites;

  const bannerUrl = org.banner_path
    ? supabase.storage.from("workspace-banners").getPublicUrl(org.banner_path).data
        .publicUrl
    : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerUrl}
          alt={`${org.name} banner`}
          className="-mb-4 h-32 w-full rounded-lg border border-line object-cover sm:h-40"
        />
      )}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{org.name}</h1>
          <p className="mt-0.5 font-mono text-[11px] text-faint">/o/{org.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Chip tone={org.plan === "free" ? "neutral" : "accent"}>
            {org.plan.toUpperCase()}
          </Chip>
          <Chip tone={org.status === "active" ? "ok" : "err"}>
            {org.status.toUpperCase()}
          </Chip>
        </div>
      </header>

      {/* Pulse strip — one bounded line of workspace facts. */}
      <section
        aria-label="Workspace stats"
        className="grid grid-cols-2 divide-line rounded-lg border border-line bg-panel sm:grid-cols-4 sm:divide-x"
      >
        <Stat label="Members" value={String(memberCount ?? 0)} />
        <Stat label="Roles" value={String(roles.length)} />
        <Stat label="Open invites" value={showInvites ? String(inviteCount ?? 0) : "—"} />
        <Stat label="Created" value={timeAgo(org.created_at)} />
      </section>

      <section aria-label="Quick actions" className="flex flex-wrap items-center gap-2">
        {can(permissions, "manage_roles") && (
          <>
            <Link
              href={`/o/${slug}/invites`}
              className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              <UserPlus size={15} /> Invite people
            </Link>
            <Link
              href={`/o/${slug}/roles`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong px-3.5 text-sm transition-colors hover:border-faint hover:bg-raised"
            >
              <ShieldCheck size={15} /> Roles &amp; permissions
            </Link>
          </>
        )}
        {can(permissions, "post_jobs") ? (
          <Link
            href={`/o/${slug}/jobs/new`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong px-3.5 text-sm transition-colors hover:border-faint hover:bg-raised"
          >
            <Briefcase size={15} /> Post a job
          </Link>
        ) : (
          <Link
            href={`/o/${slug}/jobs`}
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line-strong px-3.5 text-sm transition-colors hover:border-faint hover:bg-raised"
          >
            <Briefcase size={15} /> Browse the board
          </Link>
        )}
      </section>

      <section>
        <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Your access here
        </h2>
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-3">
          {myRoleChips.length > 0 ? (
            myRoleChips.map((r) =>
              r.roles ? (
                <Chip key={r.roles.name} dot tone="neutral">
                  <span
                    aria-hidden
                    className="mr-1 inline-block size-1.5 rounded-full"
                    style={{ backgroundColor: r.roles!.color }}
                  />
                  {r.roles!.name}
                </Chip>
              ) : null,
            )
          ) : (
            <span className="text-xs text-muted">No roles assigned</span>
          )}
          {org.owner_id === member.user_id && (
            <Chip tone="accent">implicit owner — full access</Chip>
          )}
        </div>
      </section>

      {fresh && (
        <section className="rounded-lg border border-dashed border-line px-4 py-4">
          <h2 className="text-sm font-semibold">Set up your workspace</h2>
          <ol className="mt-2 space-y-1.5 text-sm text-muted">
            <li className="flex items-center gap-2">
              <Done /> Default roles created (Owner, Admin, Editor, Member)
            </li>
            <li className="flex items-center gap-2">
              <Todo />
              <Link href={`/o/${slug}/invites`} className="text-accent hover:underline">
                Invite your first editor
              </Link>{" "}
              — they join with the role you pick
            </li>
            <li className="flex items-center gap-2">
              <Todo />
              <Link href={`/o/${slug}/jobs/new`} className="text-accent hover:underline">
                Post your first job
              </Link>{" "}
              — or browse the board if you&apos;re here as an editor
            </li>
          </ol>
        </section>
      )}

      {showAdmin && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              Audit log
            </h2>
            <Link
              href={`/o/${slug}/settings`}
              className="font-mono text-[11px] text-faint hover:text-accent"
            >
              full settings →
            </Link>
          </div>
          {audit.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
              No activity recorded yet.
            </p>
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
              {audit.map((a) => (
                <li key={a.id} className="flex items-baseline gap-3 px-3 py-2 text-sm">
                  <span className="w-16 shrink-0 font-mono text-[11px] text-faint">
                    {timeAgo(a.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-muted">
                      {a.actor_name ?? "system"}
                    </span>{" "}
                    <span className="font-mono text-[12px]">{a.action}</span>
                    {a.target_name ? (
                      <span className="text-muted"> → {a.target_name}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-line px-3 py-2.5 sm:border-b-0">
      <span className="block font-mono text-lg leading-tight">{value}</span>
      <span className="block text-[11px] text-muted">{label}</span>
    </div>
  );
}

function Done() {
  return (
    <span aria-hidden className="font-mono text-ok">
      ✓
    </span>
  );
}

function Todo() {
  return (
    <span aria-hidden className="font-mono text-faint">
      ○
    </span>
  );
}
