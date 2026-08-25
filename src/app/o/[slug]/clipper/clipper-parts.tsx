"use client";

import { useActionState } from "react";
import { Sparkles } from "lucide-react";
import { createClipJobAction } from "@/app/actions/clipper";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import type { Clip } from "@/lib/types";

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
          {state.error && <Alert kind="error">{state.error}</Alert>}
          <Button type="submit" loading={pending} className="justify-self-start">
            {!pending && <Sparkles size={14} />} Queue clipping job
          </Button>
        </>
      )}
    </form>
  );
}

export function ClipCard({ clip, url }: { clip: Clip; url: string | null }) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-canvas">
      {url ? (
        <video src={url} controls className="aspect-video w-full bg-black" />
      ) : (
        <div className="aspect-video w-full animate-pulse bg-raised" />
      )}
      <div className="grid gap-1 px-3 py-2">
        {clip.title && <p className="text-sm font-medium text-ink">{clip.title}</p>}
        <div className="flex flex-wrap items-center gap-1.5">
          {clip.viral_score !== null && (
            <Chip dot tone={clip.viral_score >= 70 ? "ok" : "info"}>
              score {clip.viral_score}
            </Chip>
          )}
          {clip.caption_style && (
            <Chip dot={false} tone="neutral">
              {clip.caption_style}
            </Chip>
          )}
          {clip.start_seconds !== null && clip.end_seconds !== null && (
            <span className="font-mono text-[10px] text-faint">
              {Math.floor(clip.start_seconds / 60)}:
              {String(Math.floor(clip.start_seconds % 60)).padStart(2, "0")} –{" "}
              {Math.floor(clip.end_seconds / 60)}:
              {String(Math.floor(clip.end_seconds % 60)).padStart(2, "0")}
            </span>
          )}
        </div>
        {url && (
          <a
            href={url}
            download
            className="font-mono text-[10px] text-faint hover:text-accent"
          >
            download ↓
          </a>
        )}
      </div>
    </div>
  );
}
