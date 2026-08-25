import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import { Chip } from "@/components/ui/chip";
import { RealtimeRefresher } from "@/app/o/[slug]/jobs/realtime-refresher";
import { WorkflowButtons } from "./workflow-buttons";
import { ReviewRoom } from "./review-room";
import type { VersionRow, CommentRow } from "./types";

export const metadata: Metadata = { title: "Review" };

const STATUS_TONE = {
  pending: "info",
  revision_requested: "accent",
  approved: "ok",
  rejected: "err",
} as const;

type SubmissionRow = {
  id: string;
  job_id: string;
  organization_id: string;
  editor_id: string;
  status: keyof typeof STATUS_TONE;
  revision_count: number;
};

export default async function SubmissionReviewPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const { org, permissions, member } = await requireOrgContext(slug);
  const supabase = await createClient();

  const { data: sub } = await supabase
    .from("submissions")
    .select("*")
    .eq("id", id)
    .eq("organization_id", org.id)
    .maybeSingle();

  // RLS already hides invisible submissions; belt-and-braces check here.
  if (!sub) notFound();
  const submission = sub as unknown as SubmissionRow;

  const isEditor = submission.editor_id === member.user_id;
  const canReview = can(permissions, "review_submissions");
  if (!isEditor && !canReview) notFound();

  const [{ data: job }, { data: versions }, { data: profile }] = await Promise.all([
    supabase
      .from("jobs")
      .select("title, status, assigned_to")
      .eq("id", submission.job_id)
      .single(),
    supabase
      .from("submission_versions")
      .select("*")
      .eq("submission_id", submission.id)
      .order("version_number"),
    supabase.from("profiles").select("display_name").eq("id", submission.editor_id).single(),
  ]);

  const versionRows = (versions ?? []) as unknown as VersionRow[];

  const { data: comments } =
    versionRows.length > 0
      ? await supabase
          .from("comments")
          .select("*")
          .in(
            "version_id",
            versionRows.map((v) => v.id),
          )
          .order("created_at")
      : { data: [] as never[] };
  const commentRows = (comments ?? []) as unknown as CommentRow[];

  const authorIds = [...new Set(commentRows.map((c) => c.author_id))];
  const { data: peopleRows } =
    authorIds.length > 0
      ? await supabase.from("profiles").select("id, display_name").in("id", authorIds)
      : { data: [] as never[] };
  const authors = Object.fromEntries(
    (peopleRows ?? []).map((p) => [p.id, p.display_name]),
  );

  // The review lives with the approved submission — one per submission.
  const { data: reviewRow } = await supabase
    .from("reviews")
    .select("rating, note, reviewer_id, updated_at")
    .eq("submission_id", submission.id)
    .maybeSingle();
  let review = null;
  if (reviewRow) {
    const { data: reviewerProfile } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", reviewRow.reviewer_id)
      .single();
    review = {
      rating: reviewRow.rating,
      note: reviewRow.note,
      reviewerName: reviewerProfile?.display_name ?? "member",
      updatedAt: reviewRow.updated_at,
    };
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <RealtimeRefresher
        organizationId={org.id}
        tables={["jobs", "submissions", "submission_versions", "comments"]}
      />

      <header className="grid gap-2">
        <Link
          href={`/o/${slug}/jobs/${submission.job_id}`}
          className="font-mono text-[11px] text-faint hover:text-accent"
        >
          ← {(job as unknown as { title: string })?.title ?? "job"}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Review room</h1>
          <Chip tone={STATUS_TONE[submission.status]}>
            {submission.status.replace("_", " ")}
          </Chip>
          {submission.revision_count > 0 && (
            <Chip dot={false} tone="neutral">
              {submission.revision_count} revision{submission.revision_count === 1 ? "" : "s"} requested
            </Chip>
          )}
        </div>
        <p className="text-sm text-muted">
          Delivered by{" "}
          <span className="text-ink">{profile?.display_name ?? "editor"}</span> ·{" "}
          {versionRows.length} version{versionRows.length === 1 ? "" : "s"}
        </p>
      </header>

      {canReview && submission.status === "pending" && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-line bg-panel px-4 py-3">
          <p className="max-w-md text-xs text-muted">
            Pin your notes along the timeline, then send it back for changes — or
            close the job out.
          </p>
          <WorkflowButtons
            slug={slug}
            submissionId={submission.id}
            canApprove={can(permissions, "approve_submissions")}
          />
        </section>
      )}

      <ReviewRoom
        slug={slug}
        submissionId={submission.id}
        organizationId={org.id}
        versions={versionRows}
        comments={commentRows}
        authors={authors}
        currentUserId={member.user_id}
        canReview={canReview}
        canApprove={can(permissions, "approve_submissions")}
        approved={submission.status === "approved"}
        review={review}
      />
    </div>
  );
}
