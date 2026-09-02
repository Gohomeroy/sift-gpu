import { Suspense } from "react";
import type { Metadata } from "next";
import { Chip } from "@/components/ui/chip";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { EmptyState } from "@/components/ui/empty";
import { DangerButton } from "@/components/ui/danger-button";
import { RealtimeRefresher } from "../jobs/realtime-refresher";
import { deleteClipJobAction } from "@/app/actions/clipper";
import { NewJobForm, ClipCard, JobProgress, EditHint } from "./clipper-parts";
import { timeAgo } from "@/lib/utils";
import type { Clip, ClipJob, LinkedAccount, ClipPost } from "@/lib/types";

export const metadata: Metadata = { title: "AI Clipper" };

const STATUS_TONE = {
  queued: "info",
  processing: "accent",
  completed: "ok",
  failed: "err",
} as const;

export default async function ClipperPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, member, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const [{ data: jobs }, { data: clips }, { data: accounts }, { data: posts }] = await Promise.all([
    supabase
      .from("clip_jobs")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    supabase.from("clips").select("*").eq("organization_id", org.id),
    supabase
      .from("linked_accounts")
      .select("*")
      .eq("user_id", member.user_id)
      .order("created_at", { ascending: false }),
    supabase.from("clip_posts").select("*").eq("organization_id", org.id),
  ]);

  const jobRows = (jobs ?? []) as unknown as ClipJob[];
  const clipsByJob = new Map<string, Clip[]>();
  for (const c of (clips ?? []) as unknown as Clip[]) {
    const list = clipsByJob.get(c.job_id) ?? [];
    list.push(c);
    clipsByJob.set(c.job_id, list);
  }
  // Sort clips by viral_score descending (highest virality first).
  for (const list of clipsByJob.values()) {
    list.sort((a, b) => (b.viral_score ?? -1) - (a.viral_score ?? -1));
  }

  // Signed URLs for rendered clips (private bucket, org-gated) — parallelized.
  const clipRows = (clips ?? []) as unknown as Clip[];
  const urlEntries = await Promise.all(
    clipRows.map(async (c) => {
      const { data } = await supabase.storage
        .from("clips")
        .createSignedUrl(c.storage_path, 3600);
      return [c.id, data?.signedUrl ?? null] as const;
    }),
  );
  const urlByClip = new Map<string, string>(urlEntries.filter((e): e is [string, string] => e[1] !== null));

  const used = jobRows.length;
  const isFree = org.plan === "free";

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <RealtimeRefresher
        organizationId={org.id}
        tables={["clip_jobs", "clips"]}
      />

      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">AI Clipper</h1>
          <p className="mt-0.5 max-w-lg text-sm text-muted">
            Paste a long-form video — the pipeline finds the moments worth
            clipping and renders them with viral captions.
          </p>
        </div>
        <Chip tone={isFree ? "neutral" : "accent"}>
          {isFree ? `FREE · ${used}/3 VIDEOS` : org.plan.toUpperCase()}
        </Chip>
      </header>

      <NewJobForm slug={slug} organizationId={org.id} disabled={isFree && used >= 3} />

      <section className="grid gap-3">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Jobs ({jobRows.length})
        </h2>

        {jobRows.length === 0 ? (
          <EmptyState
            title="No clipping jobs yet"
            hint="Paste your first podcast, stream VOD or interview above."
          />
        ) : (
          <ul className="grid gap-3">
            {jobRows.map((job) => {
              const clips = clipsByJob.get(job.id) ?? [];
              return (
                <li key={job.id} className="rounded-lg border border-line bg-panel p-4">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="text-sm font-medium text-ink">{job.title}</p>
                    <Chip dot tone={STATUS_TONE[job.status]}>
                      {job.status}
                    </Chip>
                    <span className="font-mono text-[10px] text-faint">
                      {timeAgo(job.created_at)}
                    </span>
                    <Chip tone="neutral">
                      {job.clip_count ?? 3} clips
                    </Chip>
                    <span className="ml-auto">
                      {job.created_by === member.user_id && (
                        <form action={deleteClipJobAction}>
                          <input type="hidden" name="job_id" value={job.id} />
                          <input type="hidden" name="slug" value={slug} />
                          <DangerButton label="DELETE" confirmLabel="SURE?" />
                        </form>
                      )}
                    </span>
                  </div>
                  <a
                    href={job.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 block truncate font-mono text-[11px] text-faint hover:text-accent"
                  >
                    {job.source_url}
                  </a>
                  {job.error && (
                    <p className="mt-1.5 text-xs text-err">{job.error}</p>
                  )}
                  <JobProgress job={job} />
                  {job.status === "queued" && (
                    <p className="mt-1.5 text-xs text-muted">
                      Waiting for a clipping worker — start one with{" "}
                      <code className="rounded bg-raised px-1 py-0.5 font-mono text-[10px]">
                        python main.py
                      </code>{" "}
                      (see WORKER.md).
                    </p>
                  )}

                  {clips.length > 0 && (
                    <>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {clips.map((clip) => (
                          <ClipCard
                            key={clip.id}
                            clip={clip}
                            url={urlByClip.get(clip.id) ?? null}
                            accounts={(accounts ?? []) as unknown as LinkedAccount[]}
                            posts={(posts ?? []) as unknown as ClipPost[]}
                            slug={slug}
                          />
                        ))}
                      </div>
                      {job.status === "completed" && (
                        <div className="mt-3">
                          <EditHint />
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {!can(permissions, "send_chat") && (
        <p className="text-xs text-faint">
          Clip jobs you create are visible to your whole workspace.
        </p>
      )}
    </div>
  );
}
