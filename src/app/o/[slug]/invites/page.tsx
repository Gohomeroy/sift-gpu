import type { Metadata } from "next";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { revokeInviteAction } from "@/app/actions/invites";
import { DangerButton } from "@/components/ui/danger-button";
import { EmptyState } from "@/components/ui/empty";
import { Chip } from "@/components/ui/chip";
import { formatDate, timeAgo } from "@/lib/utils";
import { InviteForm } from "./invite-form";
import type { OrganizationInvite } from "@/lib/types";

export const metadata: Metadata = { title: "Invites" };

function pickActive(list: OrganizationInvite[]) {
  const now = Date.now();
  return list.filter((inv) => {
    if (inv.expires_at && new Date(inv.expires_at).getTime() <= now)
      return false;
    if (inv.max_uses !== null && inv.uses >= inv.max_uses) return false;
    return true;
  });
}

export default async function InvitesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org } = await requireOrgContext(slug);
  const supabase = await createClient();

  const [{ data: invites }, { data: roles }] = await Promise.all([
    supabase
      .from("organization_invites")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("roles")
      .select("id, name, color")
      .eq("organization_id", org.id)
      .order("position"),
  ]);

  const roleById = new Map((roles ?? []).map((r) => [r.id, r]));
  const active = pickActive(invites ?? []);

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Invites</h1>
        <p className="mt-0.5 max-w-xl text-sm text-muted">
          Every invite carries the role the person joins with. Links are
          single-purpose tokens — revoke any you no longer recognize.
        </p>
      </header>

      <section className="rounded-lg border border-line bg-panel p-5">
        <h2 className="mb-4 text-sm font-semibold">New invite</h2>
        <InviteForm organizationId={org.id} roles={roles ?? []} />
      </section>

      <section className="grid gap-2">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Active invites ({active.length})
        </h2>
        {active.length === 0 ? (
          <EmptyState
            title="No active invites"
            hint="Create one above — links work for anyone who has them until they expire or run out of uses."
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {active.map((inv) => {
              const role = roleById.get(inv.role_id);
              return (
                <li
                  key={inv.id}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5"
                >
                  <code className="font-mono text-xs text-muted">
                    …{inv.token.slice(-10)}
                  </code>
                  {role && (
                    <Chip dot tone="neutral">
                      <span
                        aria-hidden
                        className="mr-1 inline-block size-1.5 rounded-full"
                        style={{ backgroundColor: role.color }}
                      />
                      {role.name}
                    </Chip>
                  )}
                  <span className="font-mono text-[11px] text-faint">
                    {inv.email ? `→ ${inv.email}` : "anyone with link"}
                  </span>
                  <span className="font-mono text-[11px] text-faint">
                    uses {inv.uses}
                    {inv.max_uses !== null ? `/${inv.max_uses}` : ""}
                  </span>
                  <span className="font-mono text-[11px] text-faint">
                    {inv.expires_at
                      ? `expires ${formatDate(inv.expires_at)}`
                      : "no expiry"}
                  </span>
                  <span className="ml-auto font-mono text-[11px] text-faint">
                    created {timeAgo(inv.created_at)}
                  </span>
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="invite_id" value={inv.id} />
                    <DangerButton label="REVOKE" confirmLabel="CONFIRM?" />
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
