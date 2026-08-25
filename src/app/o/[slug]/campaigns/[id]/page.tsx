import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import {
  toggleCampaignStatusAction,
  refreshAllCampaignViewsAction,
} from "@/app/actions/campaigns";
import { DangerButton } from "@/components/ui/danger-button";
import { CountUp } from "@/components/count-up";
import { GrowthBars } from "@/components/growth-bars";
import { EntryForm, EntryRow } from "../entry-parts";
import type { Campaign, CampaignEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Campaign" };

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-0.5">
      <dt className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
        {label}
      </dt>
      <dd className="font-mono text-lg font-medium text-ink">{value}</dd>
    </div>
  );
}

type Snapshot = { entry_id: string; views: number; recorded_at: string };

/** Daily cumulative view totals across entries, last 14 days max. */
function buildSeries(snaps: Snapshot[]): {
  points: number[];
  labels?: string[];
} {
  if (snaps.length === 0) return { points: [] };

  const byEntry = new Map<string, { t: number; v: number }[]>();
  let firstT = Infinity;
  for (const s of snaps) {
    const t = Date.parse(s.recorded_at);
    const list = byEntry.get(s.entry_id) ?? [];
    list.push({ t, v: s.views });
    byEntry.set(s.entry_id, list);
    if (t < firstT) firstT = t;
  }

  const days: string[] = [];
  for (
    let d = new Date(firstT);
    d.getTime() <= Date.now();
    d.setDate(d.getDate() + 1)
  ) {
    days.push(d.toISOString().slice(0, 10));
  }
  const windowed = days.slice(-14);

  const points = windowed.map((day) => {
    const cutoff = Date.parse(`${day}T23:59:59Z`);
    let sum = 0;
    for (const list of byEntry.values()) {
      let cur = 0;
      for (const p of list) {
        if (p.t <= cutoff) cur = p.v;
        else break;
      }
      sum += cur;
    }
    return sum;
  });

  return {
    points,
    labels: [
      new Date(windowed[0]!).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      }),
      "now",
    ],
  };
}

export default async function CampaignPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { org, member, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const { data: campaignRow } = await supabase
    .from("campaigns")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!campaignRow) notFound();
  const campaign = campaignRow as unknown as Campaign;

  const [{ data: entries }, { data: people }, { data: myAccounts }] = await Promise.all([
    supabase
      .from("campaign_entries")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("id, display_name, avatar_url"),
    supabase
      .from("linked_accounts")
      .select("id, platform, handle, verified_at")
      .eq("user_id", member.user_id),
  ]);

  const entryRows = (entries ?? []) as unknown as CampaignEntry[];
  const accountById = new Map(
    ((myAccounts ?? []) as { id: string; handle: string }[]).map((a) => [a.id, a.handle]),
  );
  const nameById = new Map((people ?? []).map((p) => [p.id, p.display_name]));
  const canManage = can(permissions, "manage_campaigns");
  const bannerUrl = campaign.banner_path
    ? supabase.storage.from("campaign-banners").getPublicUrl(campaign.banner_path)
        .data.publicUrl
    : "/sift-banner.svg";

  // Payout: rate × views/1k, capped per video.
  const payoutFor = (views: number) => {
    if (!campaign.rate_per_1k_views) return null;
    const raw = (views / 1000) * Number(campaign.rate_per_1k_views);
    const capped = campaign.max_payout_per_entry
      ? Math.min(raw, Number(campaign.max_payout_per_entry))
      : raw;
    return capped;
  };

  const totalViews = entryRows
    .filter((e) => e.status === "approved")
    .reduce((s, e) => s + e.views, 0);
  const totalPayout = entryRows
    .filter((e) => e.status === "approved")
    .reduce((s, e) => s + (payoutFor(e.views) ?? 0), 0);

  // ---- Growth & spend analytics -------------------------------------------
  // Authoritative numbers come from campaign_analytics() SQL. If this
  // environment hasn't had migration 0023 applied yet, fall back to
  // computing from the loaded rows so the panel still works.
  type Analytics = {
    total_entries: number;
    approved_entries: number;
    pending_entries: number;
    total_views: number;
    spent: number;
    pending_payout: number;
    avg_approved_views: number;
    budget: number | null;
    rate_per_1k_views: number | null;
    max_payout_per_entry: number | null;
    remaining_budget: number | null;
  };
  const pendingRows = entryRows.filter((e) => e.status === "pending");
  const approved = entryRows.filter((e) => e.status === "approved");
  let a: Analytics = {
    total_entries: entryRows.length,
    approved_entries: approved.length,
    pending_entries: pendingRows.length,
    total_views: totalViews,
    spent: totalPayout,
    pending_payout: pendingRows.reduce((s, e) => s + (payoutFor(e.views) ?? 0), 0),
    avg_approved_views:
      approved.length > 0
        ? approved.reduce((s, e) => s + e.views, 0) / approved.length
        : 0,
    budget: campaign.budget,
    rate_per_1k_views: campaign.rate_per_1k_views,
    max_payout_per_entry: campaign.max_payout_per_entry,
    remaining_budget:
      campaign.budget == null ? null : Math.max(Number(campaign.budget) - totalPayout, 0),
  };

  let rpcData: Analytics[] | null = null;
  try {
    const { data, error } = await supabase.rpc("campaign_analytics", {
      p_campaign_id: campaign.id,
    });
    if (!error && data && data.length > 0) {
      rpcData = data as unknown as Analytics[];
    }
  } catch {
    // Migration 0023 not applied in this environment yet — fallback stands.
  }
  if (rpcData) {
    a = { ...a, ...rpcData[0]! };
  }

  // View history → daily cumulative totals across all entries.
  let seriesPoints: number[] = [];
  let seriesLabels: string[] | undefined;
  if (entryRows.length > 0) {
    const { data: snaps } = await supabase
      .from("campaign_entry_views")
      .select("entry_id, views, recorded_at")
      .in(
        "entry_id",
        entryRows.map((e) => e.id),
      )
      .order("recorded_at", { ascending: true });

    if (snaps && snaps.length > 0) {
      const series = buildSeries(snaps as unknown as Snapshot[]);
      seriesPoints = series.points;
      seriesLabels = series.labels;
    }
  }

  const budgetUsed =
    a.budget != null && Number(a.budget) > 0
      ? Math.min(Math.round((Number(a.spent) / Number(a.budget)) * 100), 100)
      : null;

  return (
    <div className="mx-auto grid max-w-3xl gap-6">
      <Link
        href={`/o/${slug}/campaigns`}
        className="justify-self-start font-mono text-[11px] text-faint hover:text-accent"
      >
        ← campaigns
      </Link>

      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={bannerUrl}
        alt=""
        className="h-36 w-full rounded-lg border border-line object-cover sm:h-48"
      />

      <header className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{campaign.title}</h1>
          <div className="flex items-center gap-2">
            <Chip dot tone={campaign.status === "open" ? "ok" : "neutral"}>
              {campaign.status}
            </Chip>
            {canManage && (
              <form action={toggleCampaignStatusAction}>
                <input type="hidden" name="campaign_id" value={campaign.id} />
                <input type="hidden" name="slug" value={slug} />
                <input
                  type="hidden"
                  name="status"
                  value={campaign.status === "open" ? "closed" : "open"}
                />
                <DangerButton
                  label={campaign.status === "open" ? "CLOSE" : "REOPEN"}
                  confirmLabel="CONFIRM?"
                />
              </form>
            )}
          </div>
        </div>
        {campaign.reward_text && (
          <p className="font-mono text-sm text-accent">{campaign.reward_text}</p>
        )}
        <p className="whitespace-pre-wrap text-sm text-muted">{campaign.brief}</p>
        {entryRows.length > 0 && (
          <p className="font-mono text-[11px] text-faint">
            {entryRows.length} entr{entryRows.length === 1 ? "y" : "ies"}
            {totalViews > 0
              ? ` · ${totalViews.toLocaleString()} views on approved clips`
              : ""}
            {totalPayout > 0 ? ` · $${totalPayout.toFixed(2)} owed` : ""}
          </p>
        )}
        {canManage && entryRows.length > 0 && (
          <form action={refreshAllCampaignViewsAction} className="justify-self-start">
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit" variant="outline" size="sm">
              ↻ Refresh all view counts
            </Button>
          </form>
        )}
      </header>

      {/* Growth & spend */}
      <section className="grid gap-4 rounded-lg border border-line bg-panel p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
            Growth &amp; spend
          </h2>
          {a.rate_per_1k_views != null && (
            <span className="font-mono text-[10px] text-faint">
              ${Number(a.rate_per_1k_views).toFixed(2)} / 1k views
              {a.max_payout_per_entry != null
                ? ` · cap $${Number(a.max_payout_per_entry).toFixed(2)} / video`
                : ""}
            </span>
          )}
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <Stat label="Views" value={<CountUp value={Number(a.total_views)} />} />
          <Stat
            label="Spent"
            value={<CountUp value={Number(a.spent)} prefix="$" decimals={2} />}
          />
          <Stat label="Entries" value={<CountUp value={Number(a.total_entries)} />} />
          <Stat
            label="Avg / clip"
            value={<CountUp value={Math.round(Number(a.avg_approved_views))} />}
          />
        </dl>

        {a.pending_payout > 0 && a.pending_entries > 0 && (
          <p className="font-mono text-[11px] text-faint">
            ${Number(a.pending_payout).toFixed(2)} pending across{" "}
            {a.pending_entries} unapproved clip{a.pending_entries === 1 ? "" : "s"}.
          </p>
        )}

        {budgetUsed != null && (
          <div className="grid gap-1.5">
            <div className="flex justify-between font-mono text-[10px] text-faint">
              <span>BUDGET USED</span>
              <span>
                ${Number(a.spent).toFixed(2)} / ${Number(a.budget).toFixed(2)} ·{" "}
                {budgetUsed}%
                {a.remaining_budget != null
                  ? ` · $${Number(a.remaining_budget).toFixed(2)} left`
                  : ""}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              <div
                className={`h-full rounded-full ${budgetUsed >= 90 ? "bg-err" : "bg-accent"}`}
                style={{ width: `${budgetUsed}%` }}
              />
            </div>
          </div>
        )}

        {seriesPoints.length > 1 && (
          <GrowthBars points={seriesPoints} labels={seriesLabels} />
        )}
      </section>

      {campaign.status === "open" ? (
        <EntryForm
          slug={slug}
          campaignId={campaign.id}
          accounts={((myAccounts ?? []) as { id: string; platform: string; handle: string; verified_at: string | null }[])}
        />
      ) : (
        <p className="rounded-lg border border-dashed border-line px-4 py-3 text-center text-xs text-muted">
          This campaign is closed — no new entries.
        </p>
      )}

      <section className="grid gap-2">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Entries ({entryRows.length})
        </h2>
        {entryRows.length === 0 ? (
          <EmptyState
            title="No entries yet"
            hint="Be the first to post a clip for this campaign."
          />
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {entryRows.map((e) => {
              const handle = e.linked_account_id ? accountById.get(e.linked_account_id) : null;
              return (
                <EntryRow
                  key={e.id}
                  entry={e}
                  submitterName={nameById.get(e.submitted_by) ?? "member"}
                  isOwn={e.submitted_by === member.user_id}
                  canManage={canManage}
                  slug={slug}
                  payout={payoutFor(e.views)}
                  accountHandle={handle ?? null}
                />
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
