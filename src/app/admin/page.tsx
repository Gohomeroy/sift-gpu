import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/utils";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { OrgActions, PlanSelect } from "./org-actions";
import type { Organization } from "@/lib/types";

export const metadata: Metadata = { title: "Platform console" };

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("organizations")
    .select("*")
    .order("created_at", { ascending: false });
  if (q) {
    query = query.or(`name.ilike.%${q}%,slug.ilike.%${q}%`);
  }
  const { data: orgs } = await query;

  const rows = (orgs ?? []) as unknown as Organization[];
  const active = rows.filter((o) => o.status === "active").length;
  const suspended = rows.length - active;
  const byPlan = {
    free: rows.filter((o) => o.plan === "free").length,
    pro: rows.filter((o) => o.plan === "pro").length,
    studio: rows.filter((o) => o.plan === "studio").length,
  };

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Organizations</h1>
          <p className="mt-0.5 text-sm text-muted">
            Metadata only — workspace content stays behind tenant walls.
          </p>
        </div>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search name or slug…"
            aria-label="Search organizations"
            className="h-9 w-56 rounded-md border border-line bg-canvas px-3 text-sm"
          />
        </form>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "orgs", value: rows.length },
          { label: "active", value: active },
          { label: "suspended", value: suspended },
          { label: "free / pro / studio", value: `${byPlan.free} / ${byPlan.pro} / ${byPlan.studio}` },
        ].map((s) => (
          <div key={s.label} className="rounded-lg border border-line bg-panel px-3 py-2.5">
            <p className="font-mono text-lg text-ink">{s.value}</p>
            <p className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              {s.label}
            </p>
          </div>
        ))}
      </section>

      {rows.length === 0 ? (
        <EmptyState
          title={q ? `No matches for “${q}”` : "No organizations yet"}
          hint={q ? "Try a different search." : "They'll appear as customers sign up."}
        />
      ) : (
        <section className="overflow-hidden rounded-lg border border-line bg-panel">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
                <th className="px-3 py-2 font-normal">Organization</th>
                <th className="px-3 py-2 font-normal">Plan</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="hidden px-3 py-2 font-normal sm:table-cell">Created</th>
                <th className="px-3 py-2 text-right font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((org) => (
                <tr key={org.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-ink">{org.name}</p>
                    <p className="font-mono text-[11px] text-faint">/{org.slug}</p>
                  </td>
                  <td className="px-3 py-2.5">
                    <PlanSelect org={org} />
                  </td>
                  <td className="px-3 py-2.5">
                    <Chip tone={org.status === "active" ? "ok" : "err"} dot>
                      {org.status}
                    </Chip>
                  </td>
                  <td className="hidden px-3 py-2.5 font-mono text-[11px] text-faint sm:table-cell">
                    {formatDate(org.created_at)}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <OrgActions org={org} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
