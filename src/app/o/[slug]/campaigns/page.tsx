import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { NewCampaignForm } from "./new-campaign-form";
import type { Campaign } from "@/lib/types";

export const metadata: Metadata = { title: "Campaigns" };

export default async function CampaignsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const [{ data: campaigns }, { data: entries }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("campaign_entries")
      .select("campaign_id, views, status")
      .eq("organization_id", org.id),
  ]);

  const rows = (campaigns ?? []) as unknown as Campaign[];
  const entryStats = new Map<string, { count: number; views: number; approved: number }>();
  for (const e of entries ?? []) {
    const cur = entryStats.get(e.campaign_id) ?? { count: 0, views: 0, approved: 0 };
    cur.count += 1;
    cur.views += e.views;
    if (e.status === "approved") cur.approved += 1;
    entryStats.set(e.campaign_id, cur);
  }

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Campaigns</h1>
          <p className="mt-0.5 max-w-lg text-sm text-muted">
            Clipping and UGC briefs — post what you need, members submit their
            clips, you approve the winners.
          </p>
        </div>
        {can(permissions, "manage_campaigns") && (
          <NewCampaignForm slug={slug} organizationId={org.id} />
        )}
      </header>

      {rows.length === 0 ? (
        <EmptyState
          icon={<Megaphone size={18} />}
          title="No campaigns yet"
          hint={
            can(permissions, "manage_campaigns")
              ? "Launch the first clipping or UGC campaign with the button above."
              : "When the team launches a campaign, it shows up here."
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {rows.map((c) => {
            const stats = entryStats.get(c.id) ?? { count: 0, views: 0, approved: 0 };
            const bannerUrl = c.banner_path
              ? supabase.storage.from("campaign-banners").getPublicUrl(c.banner_path)
                  .data.publicUrl
              : "/sift-banner.svg";
            return (
              <li key={c.id}>
                <Link
                  href={`/o/${slug}/campaigns/${c.id}`}
                  className="block overflow-hidden rounded-lg border border-line bg-panel transition-colors hover:border-line-strong"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={bannerUrl}
                    alt=""
                    className="h-28 w-full object-cover"
                  />
                  <div className="grid gap-1.5 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink">{c.title}</p>
                      <Chip dot tone={c.status === "open" ? "ok" : "neutral"}>
                        {c.status}
                      </Chip>
                    </div>
                    {c.reward_text && (
                      <p className="font-mono text-[11px] text-accent">{c.reward_text}</p>
                    )}
                    <p className="font-mono text-[10px] text-faint">
                      {stats.count} entr{stats.count === 1 ? "y" : "ies"}
                      {stats.views > 0 ? ` · ${stats.views.toLocaleString()} views` : ""}
                      {stats.approved > 0 ? ` · ${stats.approved} approved` : ""}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
