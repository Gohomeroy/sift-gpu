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
import { EntryForm, EntryRow } from "../entry-parts";
import type { Campaign, CampaignEntry } from "@/lib/types";

export const metadata: Metadata = { title: "Campaign" };

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
