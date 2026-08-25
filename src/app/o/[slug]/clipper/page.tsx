import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { DangerButton } from "@/components/ui/danger-button";
import { RealtimeRefresher } from "../jobs/realtime-refresher";
import { deleteClipJobAction } from "@/app/actions/clipper";
import { NewJobForm, ClipCard } from "./clipper-parts";
import { timeAgo } from "@/lib/utils";
import type { Clip, ClipJob } from "@/lib/types";

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

  const [{ data: jobs }, { data: clips }] = await Promise.all([
    supabase
      .from("clip_jobs")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    supabase.from("clips").select("*").eq("organization_id", org.id),
  ]);

  const jobRows = (jobs ?? []) as unknown as ClipJob[];
  const clipsByJob = new Map<string, Clip[]>();
  for (const c of (clips ?? []) as unknown as Clip[]) {
    const list = clipsByJob.get(c.job_id) ?? [];
    list.push(c);
    clipsByJob.set(c.job_id, list);
  }

  // Signed URLs for rendered clips (private bucket, org-gated).
  const urlByClip = new Map<string, string>();
  for (const c of (clips ?? []) as unknown as Clip[]) {
    const { data } = await supabase.storage
      .from("clips")
      .createSignedUrl(c.storage_path, 3600);
    if (data?.signedUrl) urlByClip.set(c.id, data.signedUrl);
  }

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
                  {job.status === "queued" && (
                    <p className="mt-1.5 text-xs text-muted">
                      Waiting for a clipping worker —{" "}
                      <Link
                        href="https://github.com/"
                        className="text-accent hover:underline"
                      >
                        connect yours
                      </Link>{" "}
                      to process the queue (see WORKER.md).
                    </p>
                  )}

                  {clips.length > 0 && (
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">
                      {clips.map((clip) => (
                        <ClipCard
                          key={clip.id}
                          clip={clip}
                          url={urlByClip.get(clip.id) ?? null}
                        />
                      ))}
                    </div>
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
