"use client";

import { useMemo, useRef, useState, useActionState } from "react";
import { Pin, PinOff, Check, Star } from "lucide-react";
import {
  addCommentAction,
  toggleCommentResolvedAction,
} from "@/app/actions/submissions";
import { leaveReviewAction } from "@/app/actions/reviews";
import { emptyState } from "@/lib/action-state";
import { Chip } from "@/components/ui/chip";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { CommentRow, VersionRow } from "./types";

export function fmtClock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export type ReviewView = {
  rating: number;
  note: string | null;
  reviewerName: string;
  updatedAt: string;
} | null;

export function ReviewRoom({
  slug,
  submissionId,
  organizationId,
  versions,
  comments,
  authors,
  currentUserId,
  canReview,
  canApprove,
  approved,
  review,
}: {
  slug: string;
  submissionId: string;
  organizationId: string;
  versions: VersionRow[];
  comments: CommentRow[];
  authors: Record<string, string>;
  currentUserId: string;
  canReview: boolean;
  canApprove: boolean;
  approved: boolean;
  review: ReviewView;
}) {
  // Newest version selected by default — that's the one under review.
  const [activeVersionId, setActiveVersion] = useState(
    versions[versions.length - 1]?.id ?? "",
  );
  const active = versions.find((v) => v.id === activeVersionId);

  const videoRef = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [pinnedAt, setPinnedAt] = useState<number | null>(null);
  const [seekTarget, setSeekTarget] = useState<number | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const [commentState, commentAction, commentPending] = useActionState(
    addCommentAction,
    emptyState,
  );

  function seek(t: number) {
    setSeekTarget(t);
    if (videoRef.current) {
      videoRef.current.currentTime = t;
    }
    setCurrentTime(t);
  }

  const versionComments = useMemo(
    () => comments.filter((c) => c.version_id === activeVersionId),
    [comments, activeVersionId],
  );

  const pinned = versionComments
    .filter((c) => c.timestamp_seconds !== null)
    .sort((a, b) => (a.timestamp_seconds ?? 0) - (b.timestamp_seconds ?? 0));
  const general = versionComments.filter((c) => c.timestamp_seconds === null);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      {/* Player column */}
      <div className="grid content-start gap-3">
        <div className="overflow-hidden rounded-lg border border-line bg-black">
          <video
            ref={videoRef}
            controls
            preload="metadata"
            className="aspect-video w-full"
            src={`/api/drive-stream/${active?.drive_file_id}?org=${organizationId}`}
            onError={(e) => {
              const err = e.currentTarget.error;
              setMediaError(
                err ? `${err.message} (code ${err.code})` : "Unknown playback error",
              );
            }}
            onLoadedMetadata={(e) => {
              setMediaError(null);
              setDuration(e.currentTarget.duration || 0);
            }}
            onTimeUpdate={(e) => {
              setCurrentTime(e.currentTarget.currentTime);
              if (seekTarget !== null && Math.abs(seekTarget - e.currentTarget.currentTime) < 0.25) {
                setSeekTarget(null);
              }
            }}
          />
        </div>

        {/* Pin track */}
        <div
          role="slider"
          aria-label="Comment pin track"
          aria-valuenow={Math.round(currentTime)}
          tabIndex={0}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek(((e.clientX - rect.left) / rect.width) * duration);
          }}
          className="relative h-9 cursor-pointer rounded-md border border-line bg-panel"
        >
          {/* ruler ticks */}
          <div className="absolute inset-x-0 bottom-1 flex h-2 items-end justify-between px-1" aria-hidden>
            {Array.from({ length: 32 }).map((_, i) => (
              <span key={i} className={`w-px ${i % 4 === 0 ? "h-2 bg-line-strong" : "h-1 bg-line"}`} />
            ))}
          </div>

          {pinned.map((c) => (
            <span
              key={`pin-${c.id}`}
              title={`${fmtClock(c.timestamp_seconds!)} — ${c.body.slice(0, 80)}`}
              onClick={(e) => {
                e.stopPropagation();
                seek(c.timestamp_seconds!);
              }}
              style={{ left: `${((c.timestamp_seconds ?? 0) / (duration || 1)) * 100}%` }}
              className={`absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border ${
                c.resolved ? "border-ok bg-ok/40" : "border-accent bg-accent"
              }`}
            />
          ))}

          <span
            aria-hidden
            style={{ left: `${(currentTime / (duration || 1)) * 100}%` }}
            className="absolute top-0 h-full w-[2px] bg-accent"
          />
        </div>

        <div className="flex items-center justify-between font-mono text-xs text-muted">
          <span>{fmtClock(currentTime)} / {duration ? fmtClock(duration) : "--:--"}</span>
          <div className="flex items-center gap-1.5">
            {versions.map((v) => (
              <button
                key={v.id}
                onClick={() => setActiveVersion(v.id)}
                className={`cursor-pointer rounded-full border px-2 py-0.5 transition-colors ${
                  v.id === activeVersionId
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-line text-muted hover:border-line-strong hover:text-ink"
                }`}
              >
                v{v.version_number}
              </button>
            ))}
          </div>
        </div>

        {mediaError && (
          <p className="rounded-md border border-err/30 bg-err/5 px-3 py-2 text-sm text-err">
            <span className="mr-1.5 font-mono text-[10px] uppercase">playback</span>
            {mediaError}. Hard-refresh (Ctrl+Shift+R); if it persists, open
            DevTools → Network and check the status of the drive-stream request.
          </p>
        )}

        {active?.note && (
          <p className="rounded-md border border-line bg-panel px-3 py-2 text-sm text-muted">
            <span className="mr-1.5 font-mono text-[10px] uppercase">editor note</span>
            {active.note}
          </p>
        )}
      </div>

      {/* Comments column */}
      <div className="grid content-start gap-4">
        <form action={commentAction} className="grid gap-2 rounded-lg border border-line bg-panel p-3">
          <input type="hidden" name="version_id" value={activeVersionId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="submission_id" value={submissionId} />
          <input type="hidden" name="timestamp" value={pinnedAt ?? ""} />

          <textarea
            name="body"
            rows={3}
            required
            maxLength={2000}
            placeholder={
              pinnedAt !== null
                ? `Pinned at ${fmtClock(pinnedAt)} — what happens here?`
                : "Write feedback… or pin it to a moment first."
            }
            aria-label="New comment"
            className="resize-none"
          />

          {commentState.error && <Alert kind="error">{commentState.error}</Alert>}

          <div className="flex items-center justify-between">
            {pinnedAt !== null ? (
              <button
                type="button"
                onClick={() => setPinnedAt(null)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-accent bg-accent/10 px-2 py-0.5 font-mono text-[11px] text-accent"
                title="Remove the timestamp pin"
              >
                <Pin size={11} /> at {fmtClock(pinnedAt)} <PinOff size={11} className="opacity-60" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setPinnedAt(Math.round(currentTime * 10) / 10)}
                disabled={duration <= 0}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-line px-2 py-0.5 font-mono text-[11px] text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Pin size={11} /> pin at {fmtClock(currentTime)}
              </button>
            )}
            <Button type="submit" size="sm" loading={commentPending}>
              Post
            </Button>
          </div>
        </form>

        {/* Pinned notes, timeline order */}
        {pinned.length > 0 && (
          <section>
            <h3 className="mb-1.5 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              On the timeline
            </h3>
            <ul className="grid gap-1.5">
              {pinned.map((c) => (
                <CommentCard
                  key={c.id}
                  comment={c}
                  authors={authors}
                  slug={slug}
                  submissionId={submissionId}
                  onSeek={() => seek(c.timestamp_seconds!)}
                  activeSecond={currentTime}
                  canResolve={canReview || c.author_id === currentUserId}
                />
              ))}
            </ul>
          </section>
        )}

        {/* General discussion */}
        <section>
          <h3 className="mb-1.5 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
            General ({general.length})
          </h3>
          {general.length === 0 && pinned.length === 0 && (
            <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
              No notes yet. Play the cut and pin the first one.
            </p>
          )}
          <ul className="grid gap-1.5">
            {general.map((c) => (
              <CommentCard
                key={c.id}
                comment={c}
                authors={authors}
                slug={slug}
                submissionId={submissionId}
                canResolve={canReview || c.author_id === currentUserId}
              />
            ))}
          </ul>
        </section>
      </div>

      {/* Review — appears once the work is approved */}
      {approved && (
        <ReviewSection
          slug={slug}
          submissionId={submissionId}
          review={review}
          canApprove={canApprove}
        />
      )}
    </div>
  );
}

function Stars({ value, size = 13 }: { value: number; size?: number }) {
  return (
    <span className="inline-flex items-center gap-0.5 text-accent" aria-label={`${value} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          size={size}
          className={i <= value ? "fill-current" : "text-line-strong"}
        />
      ))}
    </span>
  );
}

function ReviewSection({
  slug,
  submissionId,
  review,
  canApprove,
}: {
  slug: string;
  submissionId: string;
  review: ReviewView;
  canApprove: boolean;
}) {
  const [state, action, pending] = useActionState(leaveReviewAction, emptyState);
  const [rating, setRating] = useState(review?.rating ?? 0);

  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      <h2 className="font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
        Review
      </h2>

      {review ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <Stars value={review.rating} />
            <span className="font-mono text-[11px] text-muted">
              {review.reviewerName}
            </span>
          </div>
          {review.note && (
            <p className="mt-2 text-sm text-ink">{review.note}</p>
          )}
        </div>
      ) : canApprove ? (
        <form action={action} className="mt-3 grid gap-3">
          <input type="hidden" name="submission_id" value={submissionId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="rating" value={rating} />

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">How was the work?</span>
            <span className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setRating(i)}
                  aria-label={`${i} star${i > 1 ? "s" : ""}`}
                  className="cursor-pointer rounded p-0.5 transition-colors hover:bg-raised"
                >
                  <Star
                    size={18}
                    className={i <= rating ? "fill-current text-accent" : "text-line-strong"}
                  />
                </button>
              ))}
            </span>
          </div>

          <textarea
            name="note"
            rows={2}
            maxLength={1000}
            placeholder="A line about the work (optional)…"
            aria-label="Review note"
            className="resize-none"
          />

          {state.error && <Alert kind="error">{state.error}</Alert>}

          <div className="flex justify-end">
            <Button type="submit" size="sm" loading={pending}>
              Leave review
            </Button>
          </div>
        </form>
      ) : (
        <p className="mt-2 text-sm text-muted">
          Not reviewed yet.
        </p>
      )}
    </section>
  );
}

function CommentCard({
  comment,
  authors,
  slug,
  submissionId,
  onSeek,
  activeSecond,
  canResolve,
}: {
  comment: CommentRow;
  authors: Record<string, string>;
  slug: string;
  submissionId: string;
  onSeek?: () => void;
  activeSecond?: number;
  canResolve: boolean;
}) {
  const near =
    onSeek &&
    activeSecond !== undefined &&
    Math.abs(activeSecond - (comment.timestamp_seconds ?? 0)) < 1.5;

  return (
    <li
      className={`rounded-md border px-3 py-2 ${
        near ? "border-accent/50 bg-accent/5" : comment.resolved ? "border-ok/25 bg-panel" : "border-line bg-panel"
      }`}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          {onSeek && comment.timestamp_seconds !== null && (
            <button
              type="button"
              onClick={onSeek}
              className="shrink-0 cursor-pointer rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-accent hover:underline"
            >
              {fmtClock(comment.timestamp_seconds!)}
            </button>
          )}
          <span className="truncate font-mono text-[10px] text-faint">
            {authors[comment.author_id] ?? "member"}
          </span>
        </span>
        {canResolve && (
          <form action={toggleCommentResolvedAction}>
            <input type="hidden" name="comment_id" value={comment.id} />
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="submission_id" value={submissionId} />
            <input type="hidden" name="resolved" value={comment.resolved ? "false" : "true"} />
            <button
              type="submit"
              title={comment.resolved ? "Mark unresolved" : "Mark addressed"}
              className={`cursor-pointer rounded p-1 transition-colors ${
                comment.resolved ? "text-ok" : "text-faint hover:text-ok"
              }`}
            >
              <Check size={13} />
            </button>
          </form>
        )}
        {!canResolve && comment.resolved && (
          <Chip dot={false} tone="ok" className="!px-1.5 !py-0 !text-[10px]">
            done
          </Chip>
        )}
      </div>
      <p className={`text-sm ${comment.resolved ? "text-muted line-through opacity-70" : ""}`}>
        {comment.body}
      </p>
    </li>
  );
}
