import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download } from "lucide-react";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import {
  assignApplicantAction,
  claimJobAction,
  setJobStatusAction,
  withdrawApplicationAction,
} from "@/app/actions/jobs";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { formatJobPay } from "@/lib/utils";
import { ApplyForm } from "./apply-form";
import { DeliverForm } from "./deliver-form";
import type { Job, JobApplication } from "@/lib/types";

export const metadata: Metadata = { title: "Job" };

const STATUS_TONE = {
  open: "ok",
  taken: "info",
  in_review: "accent",
  completed: "neutral",
  cancelled: "err",
} as const;

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { org, member, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const { data: jobRow } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();
  if (!jobRow) notFound();
  const job = jobRow as unknown as Job;

  const [{ data: apps }, myApp] = await Promise.all([
    supabase
      .from("job_applications")
      .select("*")
      .eq("job_id", job.id)
      .order("created_at"),
    supabase
      .from("job_applications")
      .select("id, status")
      .eq("job_id", job.id)
      .eq("user_id", member.user_id)
      .maybeSingle(),
  ]);

  const appList = (apps ?? []) as unknown as JobApplication[];
  const pendingApps = appList.filter((a) => a.status === "pending");

  const { data: submissionRowsRaw } = await supabase
    .from("submissions")
    .select("*")
    .eq("job_id", job.id)
    .order("created_at");
  const submissionRows = (submissionRowsRaw ?? []) as unknown as {
    id: string;
    editor_id: string;
    status: string;
    revision_count: number;
    created_at: string;
  }[];

  const { data: versionTipRows } =
    submissionRows.length > 0
      ? await supabase
          .from("submission_versions")
          .select("submission_id, version_number")
          .in(
            "submission_id",
            submissionRows.map((s) => s.id),
          )
          .order("version_number", { ascending: false })
      : { data: [] as never[] };
  const latestVersions = new Map<string, number>();
  for (const v of (versionTipRows ?? []) as unknown as {
    submission_id: string;
    version_number: number;
  }[]) {
    if (!latestVersions.has(v.submission_id)) {
      latestVersions.set(v.submission_id, v.version_number);
    }
  }

  const mySubmission =
    job.assigned_to === member.user_id ? submissionRows[0] : undefined;

  const peopleIds = [
    ...new Set(
      [job.created_by, job.assigned_to, ...pendingApps.map((a) => a.user_id)].filter(
        Boolean,
      ) as string[],
    ),
  ];
  const { data: peopleRows } =
    peopleIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", peopleIds)
      : { data: [] as never[] };
  const names = new Map((peopleRows ?? []).map((p) => [p.id, p.display_name]));

  const signedUrls = new Map<string, string>();
  for (const att of job.attachments ?? []) {
    const { data } = await supabase.storage.from("briefs").createSignedUrl(att.path, 3600);
    if (data?.signedUrl) signedUrls.set(att.path, data.signedUrl);
  }

  const canPost = can(permissions, "post_jobs");
  const canReview = can(permissions, "review_submissions");
  const isAssignedToMe = job.assigned_to === member.user_id;
  const isOpen = job.status === "open";

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <header className="grid gap-3">
        <Link href={`/o/${slug}/jobs`} className="font-mono text-[11px] text-faint hover:text-accent">
          ← job board
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="max-w-2xl text-xl font-semibold tracking-tight">{job.title}</h1>
          <div className="flex items-center gap-2">
            <Chip tone={STATUS_TONE[job.status]}>{job.status.replace("_", " ")}</Chip>
            {job.claim_mode === "direct" ? (
              <Chip dot={false} tone={isOpen ? "accent" : "neutral"}>
                instant claim
              </Chip>
            ) : (
              <Chip dot={false}>by application</Chip>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        {/* Main column */}
        <div className="grid content-start gap-6">
          <section className="rounded-lg border border-line bg-panel px-4 py-4">
            <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              Brief
            </h2>
            <p className="whitespace-pre-line text-sm leading-relaxed">
              {job.description || "No brief written."}
            </p>
          </section>

          {(job.attachments?.length ?? 0) > 0 && (
            <section>
              <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                Reference files ({job.attachments.length})
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
                {job.attachments.map((att) => {
                  const url = signedUrls.get(att.path);
                  return (
                    <li key={att.path} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate font-mono text-xs">{att.name}</span>
                      {url && (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex shrink-0 items-center gap-1.5 font-mono text-[11px] text-accent hover:underline"
                        >
                          <Download size={12} /> download
                        </a>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {/* Applications — reviewers see the queue */}
          {isOpen && job.claim_mode === "application" && (canReview || canPost) && (
            <section>
              <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                Applications ({pendingApps.length})
              </h2>
              {pendingApps.length === 0 ? (
                <EmptyState title="No applicants yet" />
              ) : (
                <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
                  {pendingApps.map((a) => (
                    <li key={a.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <div className="flex min-w-0 items-start gap-2.5">
                        <Avatar name={names.get(a.user_id) ?? "?"} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-sm">{names.get(a.user_id) ?? "Member"}</p>
                          {a.note && (
                            <p className="mt-0.5 line-clamp-3 text-xs text-muted">{a.note}</p>
                          )}
                        </div>
                      </div>
                      <form action={assignApplicantAction}>
                        <input type="hidden" name="job_id" value={job.id} />
                        <input type="hidden" name="user_id" value={a.user_id} />
                        <input type="hidden" name="slug" value={slug} />
                        <Button type="submit" size="sm">
                          Assign
                        </Button>
                      </form>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              Submissions
            </h2>
            <SubmissionList
              slug={slug}
              submissions={submissionRows}
              latestVersions={latestVersions}
            />
          </section>
        </div>

        {/* Meta rail */}
        <aside className="grid content-start gap-4">
          <section className="rounded-lg border border-line bg-panel px-4 py-4">
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">Pay</dt>
                <dd className="mt-0.5 font-mono">{formatJobPay(job)}</dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">Deadline</dt>
                <dd className="mt-0.5 font-mono text-xs">
                  {job.deadline
                    ? new Date(job.deadline).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "none set"}
                </dd>
              </div>
              <div>
                <dt className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">Posted by</dt>
                <dd className="mt-0.5 text-xs">{names.get(job.created_by) ?? "Member"}</dd>
              </div>
              {job.assigned_to && (
                <div>
                  <dt className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">Editor</dt>
                  <dd className="mt-0.5 text-xs">
                    {names.get(job.assigned_to)}
                    {isAssignedToMe && (
                      <span className="ml-1.5 font-mono text-[10px] text-ok">YOU</span>
                    )}
                  </dd>
                </div>
              )}
            </dl>
            {(job.required_skills?.length ?? 0) > 0 && (
              <div className="mt-4 flex flex-wrap gap-1">
                {job.required_skills.map((s) => (
                  <span key={s} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted">
                    {s}
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Actions */}
          {isOpen && !isAssignedToMe && (
            <section className="rounded-lg border border-line bg-panel px-4 py-4">
              <h2 className="mb-3 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                Your move
              </h2>
              {job.claim_mode === "direct" ? (
                can(permissions, "claim_jobs_direct") ? (
                  <form action={claimJobAction}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="slug" value={slug} />
                    <Button type="submit" className="w-full">
                      Claim this job
                    </Button>
                  </form>
                ) : (
                  <p className="text-xs text-muted">
                    You don&apos;t have permission to claim jobs in this workspace.
                  </p>
                )
              ) : can(permissions, "apply_to_jobs") ? (
                myApp && (myApp as unknown as { status: string }).status === "pending" ? (
                  <div className="grid gap-3">
                    <Alert kind="success">Application pending.</Alert>
                    <form action={withdrawApplicationAction}>
                      <input type="hidden" name="application_id" value={(myApp as unknown as { id: string }).id} />
                      <input type="hidden" name="job_id" value={job.id} />
                      <input type="hidden" name="slug" value={slug} />
                      <Button type="submit" variant="outline" size="sm" className="w-full">
                        Withdraw
                      </Button>
                    </form>
                  </div>
                ) : (
                  <ApplyForm jobId={job.id} slug={slug} />
                )
              ) : (
                <p className="text-xs text-muted">
                  You don&apos;t have permission to apply to jobs here.
                </p>
              )}
            </section>
          )}

          {isAssignedToMe && job.status !== "completed" && (
            <section className="rounded-lg border border-ok/30 bg-ok/5 px-4 py-4">
              <p className="mb-3 text-sm font-medium text-ok">
                This one&apos;s yours — deliver your cut.
              </p>
              <DeliverForm
                jobId={job.id}
                slug={slug}
                revisionCount={mySubmission?.revision_count}
              />
            </section>
          )}

          {canPost && (
            <section className="rounded-lg border border-line bg-panel px-4 py-3">
              <h2 className="mb-2 font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
                Manage
              </h2>
              <div className="grid gap-2">
                {job.status === "cancelled" && (
                  <form action={setJobStatusAction}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="status" value="open" />
                    <input type="hidden" name="slug" value={slug} />
                    <button type="submit" className="cursor-pointer font-mono text-[11px] text-muted hover:text-ok">
                      ↺ reopen listing
                    </button>
                  </form>
                )}
                {isOpen && (
                  <form action={setJobStatusAction}>
                    <input type="hidden" name="job_id" value={job.id} />
                    <input type="hidden" name="status" value="cancelled" />
                    <input type="hidden" name="slug" value={slug} />
                    <button type="submit" className="cursor-pointer font-mono text-[11px] text-muted hover:text-err">
                      ✕ cancel listing
                    </button>
                  </form>
                )}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function SubmissionList({
  slug,
  submissions,
  latestVersions,
}: {
  slug: string;
  submissions: {
    id: string;
    editor_id: string;
    status: string;
    revision_count: number;
    created_at: string;
  }[];
  latestVersions: Map<string, number>;
}) {
  if (submissions.length === 0) {
    return (
      <EmptyState
        title="No deliveries yet"
        hint="The assigned editor delivers Drive links here — each delivery becomes a numbered version."
      />
    );
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
      {submissions.map((s) => (
        <li key={s.id}>
          <Link
            href={`/o/${slug}/submissions/${s.id}`}
            className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-raised"
          >
            <Chip tone={s.status === "approved" ? "ok" : s.status === "revision_requested" ? "accent" : "info"}>
              {s.status.replace("_", " ")}
            </Chip>
            {latestVersions.get(s.id) && (
              <span className="font-mono text-xs text-muted">
                v{latestVersions.get(s.id)} delivered
              </span>
            )}
            {s.revision_count > 0 && (
              <span className="font-mono text-[11px] text-faint">
                · {s.revision_count} revision{s.revision_count === 1 ? "" : "s"}
              </span>
            )}
            <span className="ml-auto font-mono text-[11px] text-faint">open review →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
