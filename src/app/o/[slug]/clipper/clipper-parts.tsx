"use client";

import { useActionState } from "react";
import { Scissors, Sparkles } from "lucide-react";
import { createClipJobAction } from "@/app/actions/clipper";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import type { Clip, ClipJob } from "@/lib/types";

export const CAPTION_STYLES = [
  { id: "hormozi", label: "HORMOZI", hint: "White caps · gold active word" },
  { id: "beast", label: "BEAST", hint: "Lime box on the spoken word" },
  { id: "karaoke", label: "KARAOKE", hint: "Sweep to full white" },
  { id: "boxed", label: "BOXED", hint: "Black chips · active burns yellow" },
  { id: "minimal", label: "MINIMAL", hint: "Clean sentence case" },
] as const;

export function NewJobForm({
  slug,
  organizationId,
  disabled,
}: {
  slug: string;
  organizationId: string;
  disabled: boolean;
}) {
  const [state, action, pending] = useActionState(createClipJobAction, emptyState);

  return (
    <form action={action} className="grid gap-4 rounded-lg border border-line bg-panel p-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="organization_id" value={organizationId} />

      {disabled ? (
        <p className="text-sm text-muted">
          You&apos;ve used all 3 free AI clipping videos. Upgrade to Pro for
          unlimited jobs — billing lands with the Stripe stage.
        </p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-[1fr_240px]">
            <Field label="Long-form video link" htmlFor="j-url">
              <Input
                id="j-url"
                name="source_url"
                type="url"
                required
                placeholder="https://www.youtube.com/watch?v=…"
              />
            </Field>
            <Field label="Title" htmlFor="j-title">
              <Input id="j-title" name="title" required minLength={3} maxLength={120} placeholder="Podcast ep. 42" />
            </Field>
          </div>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Caption style
            </legend>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {CAPTION_STYLES.map((s, i) => (
                <label key={s.id} className="cursor-pointer">
                  <input
                    type="radio"
                    name="caption_style"
                    value={s.id}
                    defaultChecked={i === 0}
                    className="peer sr-only"
                  />
                  <span className="block rounded-md border border-line px-2 py-1.5 text-center transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent hover:border-line-strong">
                    <span className="block font-mono text-[10px] font-medium tracking-wide">
                      {s.label}
                    </span>
                    <span className="mt-0.5 block text-[9px] leading-tight text-faint">
                      {s.hint}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {state.error && <Alert kind="error">{state.error}</Alert>}
          <Button type="submit" loading={pending} className="justify-self-start">
            {!pending && <Sparkles size={14} />} Queue clipping job
          </Button>
        </>
      )}
    </form>
  );
}

const STAGES = [
  "downloading",
  "transcribing",
  "segmenting",
  "scoring",
  "watching",
  "cutting",
  "rendering",
] as const;

export function JobProgress({ job }: { job: ClipJob }) {
  if (job.status !== "processing") return null;
  const idx = STAGES.indexOf(job.stage as (typeof STAGES)[number]);
  return (
    <div className="mt-2.5 grid gap-1.5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-x-1 gap-y-1">
        {STAGES.map((s, i) => (
          <span key={s} className="flex items-center gap-1">
            <span
              className={`font-mono text-[9px] tracking-wide uppercase ${
                i < idx ? "text-ok" : i === idx ? "font-medium text-accent" : "text-faint/60"
              }`}
            >
              {i < idx ? "✓ " : ""}
              {i === idx && job.stage === "watching" ? "👁 " : ""}
              {s}
            </span>
            {i < STAGES.length - 1 && <span className="text-faint/50">›</span>}
          </span>
        ))}
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-raised">
        <div
          className="h-full rounded-full bg-accent transition-all duration-500"
          style={{ width: `${Math.max(job.progress, 3)}%` }}
        />
      </div>
    </div>
  );
}

function parseTags(tags: Clip["hashtags"]): string[] {
  if (Array.isArray(tags)) return tags;
  try {
    const parsed = JSON.parse(tags ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ClipCard({ clip, url }: { clip: Clip; url: string | null }) {
  const tags = parseTags(clip.hashtags);
  const mmss = (v: number | null) =>
    v === null
      ? ""
      : `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      <div className="relative">
        {url ? (
          <video src={url} controls className="aspect-[9/16] w-full bg-black" />
        ) : (
          <div className="aspect-[9/16] w-full animate-pulse bg-raised" />
        )}
        {clip.viral_score !== null && (
          <span
            className={`absolute right-2 top-2 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold ${
              clip.viral_score >= 80
                ? "bg-ok text-white"
                : clip.viral_score >= 65
                  ? "bg-accent text-white"
                  : "bg-canvas/90 text-ink"
            }`}
          >
            {clip.viral_score}
          </span>
        )}
        {clip.provider === "reka" && (
          <span className="absolute left-2 top-2 rounded bg-info px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide text-white">
            reka
          </span>
        )}
      </div>

      <div className="grid gap-1.5 px-3 py-2.5">
        <a
          href={url ?? "#"}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium leading-snug text-ink hover:text-accent"
        >
          {clip.title || "Untitled clip"}
        </a>

        {clip.caption && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted">{clip.caption}</p>
        )}

        {clip.reasoning && (
          <p className="border-l-2 border-accent-dim pl-2 text-[11px] italic leading-snug text-faint">
            {clip.reasoning}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-1">
          {clip.caption_style && (
            <Chip dot={false} tone="neutral">
              {clip.caption_style}
            </Chip>
          )}
          {(clip.start_seconds !== null || clip.end_seconds !== null) && (
            <span className="font-mono text-[10px] text-faint">
              {mmss(clip.start_seconds)} – {mmss(clip.end_seconds)}
            </span>
          )}
        </div>

        {tags.length > 0 && (
          <p className="truncate font-mono text-[10px] text-faint">{tags.join(" ")}</p>
        )}

        {url && (
          <a
            href={url}
            download
            className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-faint hover:text-accent"
          >
            <Scissors size={11} /> download ↓
          </a>
        )}
      </div>
    </div>
  );
}

export function EditHint() {
  return (
    <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11px] leading-relaxed text-faint">
      Want to recut or restyle a clip? Download it and drop it into{" "}
      <strong className="font-medium text-muted">SIFT Studio</strong> — trim
      moments on the timeline and export again.
    </p>
  );
}
