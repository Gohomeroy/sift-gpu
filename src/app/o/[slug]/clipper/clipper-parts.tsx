"use client";

import { useActionState } from "react";
import { Scissors, Sparkles } from "lucide-react";
import {
  createClipJobAction,
  deleteClipJobAction,
  deleteClipAction,
} from "@/app/actions/clipper";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import { DangerButton } from "@/components/ui/danger-button";
import { PostButton } from "./post-button";
import type { Clip, ClipJob, LinkedAccount, ClipPost } from "@/lib/types";

export const CAPTION_STYLES = [
  { id: "karaoke", label: "KARAOKE", hint: "Active word sweeps yellow" },
  { id: "pill", label: "PILL", hint: "Rounded pills · active turns yellow" },
  { id: "boxed", label: "BOXED", hint: "Black chips · active burns yellow" },
  { id: "minimal", label: "MINIMAL", hint: "Thin quiet uppercase" },
  { id: "two_tone", label: "TWO TONE", hint: "Heavy black outline · yellow pop" },
  { id: "pop", label: "POP", hint: "CapCut classic · bold white caps" },
] as const;

export const CAPTION_FONTS = [
  { id: "impact", label: "IMPACT", hint: "Condensed black · classic" },
  { id: "anton", label: "ANTON", hint: "Tall condensed · bold" },
  { id: "outfit", label: "OUTFIT", hint: "Modern geometric sans" },
  { id: "poppins", label: "POPPINS", hint: "Rounded geometric" },
  { id: "montserrat", label: "MONTSERRAT", hint: "Neutral grotesque" },
  { id: "rajdhani", label: "RAJDHANI", hint: "Techy squared sans" },
] as const;

export const CAPTION_SUBS = [
  { id: "plain", label: "PLAIN", hint: "No animation" },
  { id: "bounce", label: "BOUNCE", hint: "Active word bounces" },
  { id: "fade", label: "FADE", hint: "Smooth fade in" },
  { id: "zoom", label: "ZOOM", hint: "Active word scales up" },
  { id: "wave", label: "WAVE", hint: "Rises and falls" },
  { id: "rotate", label: "ROTATE", hint: "Active word tilts" },
] as const;

export const CAPTION_THEMES = [
  { id: "pop", label: "POP", hint: "White caps · gold accent" },
  { id: "karaoke", label: "KARAOKE", hint: "Dimmed white · gold active" },
  { id: "hustle", label: "HUSTLE", hint: "White · amber accent" },
  { id: "grape", label: "GRAPE", hint: "Purple panel · lavender accent" },
  { id: "beast", label: "BEAST", hint: "White · lime accent" },
  { id: "poppin", label: "POPPIN", hint: "White · pink accent" },
] as const;

export const REFRAME_STYLES = [
  { id: "track", label: "TRACK FACE", hint: "Follow-cam on the speaker" },
  { id: "blur", label: "BLUR FILL", hint: "Fit widescreen · blurred same-video bg" },
] as const;

/* --------------------------- visual mockups --------------------------- */

// Fit a caption split across two words: first = base/inactive, second = active.
function CaptionMock({
  wordOne,
  wordTwo,
  look,
  font = "var(--font-anton, 'Impact')",
  animateWordTwo,
}: {
  wordOne: string;
  wordTwo: string;
  look: { base: string; active: string; strokeW: number; strokeColor: string; size: number; weight: number; boxed?: boolean; pill?: boolean; shadow?: boolean };
  font?: string;
  animateWordTwo?: string;
}) {
  const word = (text: string, active: boolean, k: string) => {
    const boxed = look.boxed || look.pill;
    const bg = boxed
      ? active
        ? look.active
        : look.pill
          ? "rgba(230,230,230,0.96)"
          : "rgba(0,0,0,0.82)"
      : undefined;
    const color = look.pill
      ? "#111111"
      : boxed
        ? active
          ? "#111111"
          : "#FFFFFF"
        : active
          ? look.active
          : look.base;
    return (
      <span
        key={k}
        style={{
          fontFamily: font,
          fontSize: look.size,
          fontWeight: look.weight,
          lineHeight: 1.14,
          textTransform: "uppercase",
          color,
          background: bg,
          borderRadius: look.pill ? 24 : 14,
          padding: bg ? "2px 7px" : 0,
          margin: "3px 0",
          display: "inline-block",
          WebkitTextStroke:
            !boxed && look.strokeW > 0
              ? `${look.strokeW}px ${look.strokeColor}`
              : undefined,
          paintOrder: "stroke fill",
          textShadow: look.shadow ? "0 3px 12px rgba(0,0,0,0.55)" : undefined,
          transform: active && !animateWordTwo ? "scale(1.15)" : undefined,
        }}
        className={active && animateWordTwo ? animateWordTwo : undefined}
      >
        {text}
      </span>
    );
  };
  // Active word animates via its own class, so drop the inline transform.
  return (
    <span className="flex flex-wrap items-center justify-center gap-x-1">
      {word(wordOne, false, "w1")}
      {word(wordTwo, true, "w2")}
    </span>
  );
}

function MiniStage({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-md border border-line/60 bg-[#0b1524]">
      {children}
    </div>
  );
}

const CAP_LOOK: Record<string, { base: string; active: string; strokeW: number; strokeColor: string; size: number; weight: number; boxed?: boolean; pill?: boolean; shadow?: boolean }> = {
  karaoke: { base: "rgba(255,255,255,0.45)", active: "#FFD700", strokeW: 5, strokeColor: "rgba(0,0,0,0.9)", size: 13, weight: 900 },
  pill: { base: "#111111", active: "#FFD700", strokeW: 0, strokeColor: "#000000", size: 11, weight: 800, pill: true },
  boxed: { base: "#FFFFFF", active: "#FFD700", strokeW: 0, strokeColor: "#000000", size: 12, weight: 900, boxed: true },
  minimal: { base: "rgba(255,255,255,0.55)", active: "#FFFFFF", strokeW: 0, strokeColor: "transparent", size: 10, weight: 600, shadow: true },
  two_tone: { base: "#FFFFFF", active: "#FFD700", strokeW: 8, strokeColor: "#000000", size: 13, weight: 900 },
  pop: { base: "#FFFFFF", active: "#FFD700", strokeW: 9, strokeColor: "#000000", size: 14, weight: 900 },
};

function CaptionStyleMock({ id }: { id: string }) {
  return (
    <MiniStage>
      <CaptionMock wordOne="SO" wordTwo="GOOD" look={CAP_LOOK[id] ?? CAP_LOOK.pop} />
    </MiniStage>
  );
}

const FONT_LOOK: Record<string, { family: string; weight: number }> = {
  impact: { family: "var(--font-anton, 'Impact')", weight: 400 },
  anton: { family: "var(--font-anton, 'Impact')", weight: 400 },
  outfit: { family: "var(--font-outfit, 'Arial')", weight: 800 },
  poppins: { family: "var(--font-poppins, 'Arial')", weight: 800 },
  montserrat: { family: "var(--font-montserrat, 'Arial')", weight: 800 },
  rajdhani: { family: "var(--font-rajdhani, 'Arial')", weight: 700 },
};

function FontMock({ id }: { id: string }) {
  const f = FONT_LOOK[id] ?? FONT_LOOK.anton;
  return (
    <MiniStage>
      <span
        className="uppercase text-white"
        style={{
          fontFamily: f.family,
          fontWeight: f.weight,
          fontSize: 22,
          lineHeight: 1,
          WebkitTextStroke: "2px #000000",
          paintOrder: "stroke fill",
        }}
      >
        Ag
      </span>
    </MiniStage>
  );
}

const SUB_ANIM: Record<string, string | undefined> = {
  plain: undefined,
  bounce: "cap-bounce",
  fade: "cap-fade",
  zoom: "cap-zoom",
  wave: "cap-wave",
  rotate: "cap-rotate",
};

function SubMock({ id }: { id: string }) {
  return (
    <MiniStage>
      <CaptionMock wordOne="UP" wordTwo="NEXT" look={CAP_LOOK.pop} animateWordTwo={SUB_ANIM[id]} />
    </MiniStage>
  );
}

const THEME_LOOK: Record<string, { base: string; active: string; strokeW: number; strokeColor: string; bg?: string }> = {
  pop: { base: "#FFFFFF", active: "#FFD700", strokeW: 9, strokeColor: "#000000" },
  karaoke: { base: "rgba(255,255,255,0.45)", active: "#FFD700", strokeW: 5, strokeColor: "rgba(0,0,0,0.9)" },
  hustle: { base: "rgba(255,255,255,0.75)", active: "#FFC107", strokeW: 7, strokeColor: "#111111" },
  grape: { base: "#FFFFFF", active: "#C9A5FF", strokeW: 4, strokeColor: "#000000", bg: "rgba(56,18,92,0.88)" },
  beast: { base: "#FFFFFF", active: "#B7F000", strokeW: 6, strokeColor: "#000000" },
  poppin: { base: "#FFFFFF", active: "#FF5C8A", strokeW: 5, strokeColor: "#000000" },
};

function ThemeMock({ id }: { id: string }) {
  const t = THEME_LOOK[id] ?? THEME_LOOK.pop;
  return (
    <MiniStage>
      <CaptionMock
        wordOne="OH"
        wordTwo="YES"
        look={{
          base: t.base,
          active: t.active,
          strokeW: t.strokeW,
          strokeColor: t.strokeColor,
          size: 13,
          weight: 900,
          boxed: !!t.bg,
        }}
      />
    </MiniStage>
  );
}

const CONTENT_TYPES: { id: string; label: string; hint: string }[] = [
  { id: "auto", label: "AUTO", hint: "Let the AI decide" },
  { id: "podcast", label: "PODCAST", hint: "Arc-based, hook→payoff" },
  { id: "streamer", label: "STREAMER", hint: "Events & reactions" },
];

function ContentTypeMock({ id }: { id: string }) {
  if (id === "podcast") {
    // Two talking heads + waveform — the arc pipeline.
    return (
      <MiniStage>
        <div className="flex w-full items-center justify-around px-3">
          <span className="h-7 w-7 rounded-full bg-[#1d3352] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
          <span className="flex h-5 items-end gap-0.5">
            {[4, 7, 5, 9, 6, 8, 4].map((h, i) => (
              <span key={i} className="w-[2px] rounded-sm bg-accent/70" style={{ height: `${h * 2}px` }} />
            ))}
          </span>
          <span className="h-7 w-7 rounded-full bg-[#1d3352] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
        </div>
      </MiniStage>
    );
  }
  if (id === "streamer") {
    // Reaction face + chat bubbles — the event pipeline.
    return (
      <MiniStage>
        <div className="flex w-full items-center justify-between px-3">
          <div className="flex h-5 w-12 flex-col justify-center gap-0.5">
            <span className="h-1.5 w-9 rounded-sm bg-[#223a5f]" />
            <span className="h-1.5 w-7 rounded-sm bg-[#1d3352]" />
          </div>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/20 text-[10px] leading-none">
            😂
          </span>
        </div>
      </MiniStage>
    );
  }
  // auto: a question mark melting into the two paths — the AI decides.
  return (
    <MiniStage>
      <div className="relative flex items-center">
        <span className="font-mono text-sm font-black text-accent">?</span>
        <span className="ml-1.5 h-px w-5 bg-accent/40" />
        <span className="flex items-end gap-0.5">
          <span className="h-[9px] w-[2px] rounded-sm bg-faint/60" />
          <span className="h-[13px] w-[2px] rounded-sm bg-faint/60" />
          <span className="h-[7px] w-[2px] rounded-sm bg-faint/60" />
        </span>
      </div>
    </MiniStage>
  );
}

function FrameMock({ mode }: { mode: "track" | "blur" }) {
  if (mode === "track") {
    // Face fills the whole 9:16 frame — no bars.
    return (
      <div className="relative h-20 w-full overflow-hidden rounded-md border border-line/60 bg-[#0b1524]">
        <div className="absolute left-1/2 top-1/2 h-16 w-16 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[#1d3352] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
      </div>
    );
  }
  // Widescreen fill: blurred same-video bars top + bottom, sharp center strip.
  return (
    <div className="relative h-20 w-full overflow-hidden rounded-md border border-line/60 bg-[#0b1524]">
      <div className="absolute inset-x-0 top-0 flex h-[22%] items-center justify-center gap-2 overflow-hidden blur-[2px]">
        <span className="h-8 w-8 rounded-full bg-[#223a5f]/70" />
        <span className="h-10 w-1 rounded-full bg-[#1d3352]" />
        <span className="h-7 w-1 rounded-full bg-[#223a5f]/60" />
      </div>
      <div className="absolute inset-x-0 bottom-0 flex h-[22%] items-center justify-center gap-2 overflow-hidden blur-[2px]">
        <span className="h-8 w-8 rounded-full bg-[#223a5f]/70" />
        <span className="h-10 w-1 rounded-full bg-[#1d3352]" />
        <span className="h-7 w-1 rounded-full bg-[#223a5f]/60" />
      </div>
      <div className="absolute inset-x-0 top-1/2 h-[56%] -translate-y-1/2 border-y border-white/10 bg-[#0b1524]">
        <div className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-[50%] bg-[#1d3352] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]" />
      </div>
    </div>
  );
}

function ChoiceCard({
  name,
  value,
  defaultChecked,
  preview,
  label,
  hint,
}: {
  name: string;
  value: string;
  defaultChecked: boolean;
  preview: React.ReactNode;
  label: string;
  hint?: string;
}) {
  return (
    <label className="h-full cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="flex h-full flex-col gap-1.5 rounded-lg border border-line bg-canvas p-1 transition-colors peer-checked:border-accent peer-checked:bg-accent/10 hover:border-line-strong">
        {preview}
        <span className="px-0.5 pb-0.5 text-center">
          <span className="block font-mono text-[9px] font-medium tracking-wide text-ink">
            {label}
          </span>
          {hint && (
            <span className="mt-0.5 block text-[8px] leading-tight text-faint">
              {hint}
            </span>
          )}
        </span>
      </span>
    </label>
  );
}

function ChoiceGrid({
  name,
  options,
  defaultChecked,
  columns,
  render,
}: {
  name: string;
  options: readonly { id: string; label: string }[];
  defaultChecked: string;
  columns: string;
  render: (id: string) => React.ReactNode;
}) {
  return (
    <div className={`${columns} gap-2`}>
      {options.map((s) => (
        <ChoiceCard
          key={s.id}
          name={name}
          value={s.id}
          defaultChecked={s.id === defaultChecked}
          preview={render(s.id)}
          label={s.label}
        />
      ))}
    </div>
  );
}

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
              Content type
            </legend>
            <div className="grid grid-cols-3 gap-2">
              {CONTENT_TYPES.map((c, i) => (
                <ChoiceCard
                  key={c.id}
                  name="content_type"
                  value={c.id}
                  defaultChecked={i === 0}
                  preview={<ContentTypeMock id={c.id} />}
                  label={c.label}
                  hint={c.hint}
                />
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Frame mode
            </legend>
            <div className="grid grid-cols-2 gap-2">
              <ChoiceCard
                name="reframe_style"
                value="track"
                defaultChecked
                preview={<FrameMock mode="track" />}
                label="TRACK FACE"
                hint="Follow-cam, fills 9:16"
              />
              <ChoiceCard
                name="reframe_style"
                value="blur"
                defaultChecked={false}
                preview={<FrameMock mode="blur" />}
                label="BLUR FILL"
                hint="Widescreen, blurred bars"
              />
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Caption style
            </legend>
            <ChoiceGrid
              name="caption_style"
              options={CAPTION_STYLES}
              defaultChecked="pop"
              columns="grid grid-cols-3 sm:grid-cols-6"
              render={(id) => <CaptionStyleMock id={id} />}
            />
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Font
            </legend>
            <ChoiceGrid
              name="caption_font"
              options={CAPTION_FONTS}
              defaultChecked="anton"
              columns="grid grid-cols-3 sm:grid-cols-6"
              render={(id) => <FontMock id={id} />}
            />
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Sub animation
            </legend>
            <ChoiceGrid
              name="caption_sub"
              options={CAPTION_SUBS}
              defaultChecked="zoom"
              columns="grid grid-cols-3 sm:grid-cols-6"
              render={(id) => <SubMock id={id} />}
            />
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Theme
            </legend>
            <ChoiceGrid
              name="caption_theme"
              options={CAPTION_THEMES}
              defaultChecked="pop"
              columns="grid grid-cols-3 sm:grid-cols-6"
              render={(id) => <ThemeMock id={id} />}
            />
          </fieldset>

          <fieldset>
            <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Clips to generate
            </legend>
            <div className="grid grid-cols-5 gap-1.5 sm:grid-cols-10">
              {[1,2,3,4,5,6,7,8,9,10].map((n) => (
                <label key={n} className="cursor-pointer">
                  <input
                    type="radio"
                    name="clip_count"
                    value={n}
                    defaultChecked={n === 3}
                    className="peer sr-only"
                  />
                  <span className="block rounded-md border border-line px-2 py-1.5 text-center transition-colors peer-checked:border-accent peer-checked:bg-accent/10 peer-checked:text-accent hover:border-line-strong">
                    <span className="block font-mono text-[10px] font-medium tracking-wide">
                      {n}
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
  "analyzing",
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

export function ClipDeleteButton({
  clipId,
  slug,
}: {
  clipId: string;
  slug: string;
}) {
  const [state, action, pending] = useActionState(deleteClipAction, emptyState);

  return (
    <form action={action} className="flex items-center gap-1.5">
      <input type="hidden" name="clip_id" value={clipId} />
      <input type="hidden" name="slug" value={slug} />
      <DangerButton
        label="delete"
        confirmLabel="delete?"
        disabled={pending}
        className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-1 font-mono text-[10px] text-faint transition-colors duration-150 hover:bg-raised hover:text-err disabled:cursor-default disabled:opacity-50"
      />
      {state.error && <span className="text-[10px] text-err">{state.error}</span>}
    </form>
  );
}

export function JobDeleteControl({
  jobId,
  slug,
}: {
  jobId: string;
  slug: string;
}) {
  const [state, action, pending] = useActionState(deleteClipJobAction, emptyState);

  return (
    <form action={action} className="inline-flex items-center gap-1.5">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="slug" value={slug} />
      <DangerButton label="DELETE" confirmLabel="SURE?" disabled={pending} />
      {state.error && <span className="text-[10px] text-err">{state.error}</span>}
    </form>
  );
}

export function ClipCard({
  clip,
  url,
  accounts,
  posts,
  slug,
  canDelete,
}: {
  clip: Clip;
  url: string | null;
  accounts: LinkedAccount[];
  posts: ClipPost[];
  slug: string;
  canDelete?: boolean;
}) {
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
          {clip.reframe_style && (
            <Chip dot={false} tone="accent">
              {clip.reframe_style === "blur" ? "blur fill" : "track face"}
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

        <div className="flex flex-wrap items-center gap-2">
          {url && (
            <a
              href={url}
              download
              className="inline-flex items-center gap-1 font-mono text-[10px] text-faint hover:text-accent"
            >
              <Scissors size={11} /> download ↓
            </a>
          )}
          {url && (
            <PostButton
              clip={clip}
              url={url}
              accounts={accounts}
              posts={posts}
              slug={slug}
            />
          )}
          {canDelete && (
            <span className="ml-auto">
              <ClipDeleteButton clipId={clip.id} slug={slug} />
            </span>
          )}
        </div>
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
