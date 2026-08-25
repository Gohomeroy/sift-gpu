import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getUserOrganizations } from "@/lib/org-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { CountUp } from "@/components/count-up";
import { GrowthBars } from "@/components/growth-bars";

export default async function Home() {
  const user = await getSessionUser();

  if (user) {
    const orgs = await getUserOrganizations();
    redirect(orgs.length > 0 ? `/o/${orgs[0]!.slug}` : "/onboarding");
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-5xl flex-col px-6">
      <header className="flex items-center justify-between py-5">
        <span className="font-mono text-sm font-medium tracking-widest">
          SIFT<span className="sift-tick" aria-hidden />
        </span>
        <nav className="flex items-center gap-2">
          <ThemeToggle />
          <Link
            href="/sign-in"
            className="rounded-md px-3 py-1.5 text-sm text-muted transition-colors hover:bg-raised hover:text-ink"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            Create account
          </Link>
        </nav>
      </header>

      <main className="flex flex-1 flex-col items-center gap-14 py-16">
        <section className="max-w-2xl text-center">
          <p className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
            For editing teams
          </p>
          <h1 className="text-balance text-phi-title font-semibold sm:text-phi-display">
            Feedback that lands on the exact frame.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-balance text-muted text-phi-body">
            SIFT gives your agency an isolated workspace: a job board for edit
            work, Drive-link submissions with versioned revision rounds, and
            review comments pinned to the second they&apos;re about — plus a
            community for your roster.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/sign-up"
              className="inline-flex h-10 items-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
            >
              Create a free workspace
            </Link>
            <Link
              href="/onboarding"
              className="inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm transition-colors hover:border-faint hover:bg-raised"
            >
              Join with an invite
            </Link>
          </div>
        </section>

        {/* The mechanism: scrub → stop on 00:45 → comment pins to the second. */}
        <MechanismScene />

        {/* The pipeline: create → review pinned → clip & distribute. */}
        <section className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-14">
          <div>
            <p className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              AI Clipper
            </p>
            <h2 className="mt-4 text-balance text-phi-heading font-semibold sm:text-phi-title">
              One link in. Shorts out.
            </h2>
            <p className="mt-4 text-balance text-muted text-phi-body">
              Paste a link to a stream, podcast or long-form upload. SIFT finds
              the spikes, cuts them vertical and burns your caption preset —
              every clip lands in a gallery with its viral score.
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {["HORMOZI", "BEAST", "CLEAN", "KARAOKE"].map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-line bg-raised px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted"
                >
                  {p}
                </span>
              ))}
            </div>
            <p className="mt-4 font-mono text-[11px] text-faint">
              Free workspaces: 3 videos.
            </p>
            <Link
              href="/sign-up"
              className="mt-5 inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm transition-colors hover:border-faint hover:bg-raised"
            >
              Try the clipper
            </Link>
          </div>
          <ClipperScene />
        </section>

        <section className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-14">
          <StudioScene />
          <div className="order-first lg:order-last">
            <p className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              SIFT Studio
            </p>
            <h2 className="mt-4 text-balance text-phi-heading font-semibold sm:text-phi-title">
              Edit live, in the browser.
            </h2>
            <p className="mt-4 text-balance text-muted text-phi-body">
              A multi-track editor that lives next to your job board — no
              installs, no render exports. Describe the change in chat and
              watch the timeline obey, then ship the cut straight into review.
            </p>
            <Link
              href="/sign-up"
              className="mt-6 inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm transition-colors hover:border-faint hover:bg-raised"
            >
              Open the studio
            </Link>
          </div>
        </section>

        {/* Clipping campaigns: briefs, verified clippers, tracked spend. */}
        <section className="grid w-full max-w-5xl items-center gap-10 lg:grid-cols-[22rem_minmax(0,1fr)] lg:gap-14">
          <div>
            <p className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
              Clipping campaigns
            </p>
            <h2 className="mt-4 text-balance text-phi-heading font-semibold sm:text-phi-title">
              Post a brief. Pay for views.
            </h2>
            <p className="mt-4 text-balance text-muted text-phi-body">
              Launch a UGC campaign with a payout per 1k tracked views and a
              hard cap per video. Clippers link their accounts once, entries
              come only from verified handles, and every count is
              platform-checked — never self-reported.
            </p>
            <div className="mt-5 flex flex-wrap gap-1.5">
              {["TIKTOK", "YOUTUBE", "INSTAGRAM"].map((p) => (
                <span
                  key={p}
                  className="rounded-full border border-line bg-raised px-2.5 py-1 font-mono text-[10px] tracking-wide text-muted"
                >
                  {p}
                </span>
              ))}
            </div>
            <Link
              href="/sign-up"
              className="mt-5 inline-flex h-10 items-center rounded-md border border-line-strong px-4 text-sm transition-colors hover:border-faint hover:bg-raised"
            >
              Run a campaign
            </Link>
          </div>
          <GrowthScene />
        </section>

        {/* The cycle, as a timeline. Illustrative pass — not live data. */}
        <section aria-label="How a review cycle looks" className="w-full pb-2">
          <div className="mb-1.5 flex h-3 items-end gap-[7px]" aria-hidden>
            {Array.from({ length: 40 }).map((_, i) => (
              <span
                key={i}
                className={`w-px ${i % 8 === 0 ? "h-3 bg-line-strong" : "h-1.5 bg-line"}`}
              />
            ))}
          </div>
          <div className="flex min-w-max items-stretch gap-[3px] font-mono text-[11px]">
            <Clip tone="neutral" head="JOB-014 · OPEN" body="60s promo · $400" />
            <Arrow />
            <Clip tone="ok" head="CLAIMED" body="@mara edits" />
            <Arrow />
            <Clip tone="info" head="v1 SUBMITTED" body="drive.link/…" />
            <Arrow />
            <Clip tone="accent" head="NOTE @00:45" body="“cut feels early”" />
            <Arrow />
            <Clip tone="err" head="REV REQUESTED" body="round 2" />
            <Arrow />
            <Clip tone="ok" head="v2 APPROVED" body="rated ★ 5.0" />
          </div>
        </section>

        <p className="text-center font-mono text-xs text-faint">
          Free workspaces: 5 active jobs · 10 editors. Paid plans raise the caps.
        </p>
      </main>

      <footer className="border-t border-line py-4">
        <div className="flex flex-col items-center justify-between gap-1.5 font-mono text-[11px] text-faint sm:flex-row">
          <span>SIFT — the operating desk for editing teams</span>
          <span>© 2026 SIFT · All rights reserved</span>
          <span>v0.1 foundation</span>
        </div>
      </footer>
    </div>
  );
}

/*
 * One authored loop (8s): the playhead scrubs across real footage,
 * settles on 00:45, and mara's comment pins to that exact second.
 * HTML-over-video so the source plays live; tokens only,
 * transform/opacity motion. Natural state is the completed story —
 * reduced-motion users see it statically.
 */
function MechanismScene() {
  return (
    <section
      aria-label="SIFT review demo: a comment pinned to 00:45"
      className="w-full max-w-3xl select-none"
    >
      <div className="sift-scene rounded-lg border border-line bg-panel p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="flex gap-1" aria-hidden>
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
            <span className="h-2 w-2 rounded-full bg-line-strong" />
          </span>
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
            SIFT · REVIEW ROOM
          </span>
          <span className="rounded-full bg-raised px-2 py-0.5 font-mono text-[10px] text-muted">
            v2 IN REVIEW
          </span>
        </div>

        <div className="relative overflow-hidden rounded-md border border-line">
          {/* Live footage */}
          <video
            src={SRC_MAIN}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="block aspect-video w-full object-cover"
          />
          <span className="absolute left-2 top-2 rounded bg-canvas/90 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            PROMO_CUT_v2.MP4
          </span>
          <span className="sift-note absolute right-2 top-2 rounded bg-canvas/90 px-1.5 py-0.5 font-mono text-xs text-accent">
            00:45
          </span>

          {/* Playhead (scrubs, settles on the pin at 75% = 00:45) */}
          <div
            className="sift-playhead pointer-events-none absolute inset-y-0 left-0 w-full"
            style={{ "--pin-x": "75%" } as React.CSSProperties}
            aria-hidden
          >
            <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
          </div>

          {/* Comment card, pinned through the elbow to the track */}
          <div className="sift-note pointer-events-none absolute inset-0" aria-hidden>
            <span className="absolute bottom-[13px] left-[75%] h-[54px] w-px bg-accent-dim" />
            <figure className="absolute bottom-16 right-3 w-52 rounded-lg border border-line-strong bg-overlay p-2.5 sm:w-60">
              <figcaption className="flex items-center gap-2">
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-dim font-mono text-[9px] font-semibold text-accent">
                  M
                </span>
                <span className="text-xs font-semibold text-ink">mara</span>
                <span className="ml-auto rounded bg-accent-dim px-1 py-0.5 font-mono text-[10px] text-accent">
                  @ 00:45
                </span>
              </figcaption>
              <p className="mt-1.5 text-xs leading-snug text-muted">
                “Cut feels early — tighten to 00:38.”
              </p>
            </figure>
          </div>

          {/* Scrub track */}
          <div className="absolute inset-x-0 bottom-2" aria-hidden>
            <div className="relative h-1 w-full bg-canvas/70">
              <span className="absolute inset-y-0 left-[75%] w-px bg-accent" />
            </div>
            <div className="mt-1 flex justify-between px-2 font-mono text-[9px] text-canvas/90 [text-shadow:0_1px_2px_rgba(0,0,0,.7)]">
              <span>0:00</span>
              <span>0:30</span>
              <span>1:00</span>
            </div>
            {/* Pin + pulse ring */}
            <span className="absolute -top-1.5 left-[calc(75%-4.5px)] h-1.5 w-1.5 rounded-full bg-accent" />
            <span className="sift-pin-ring absolute -top-1.5 left-[calc(75%-4.5px)] h-1.5 w-1.5 rounded-full border-2 border-accent opacity-0" />
          </div>
        </div>
      </div>
    </section>
  );
}

/*
 * Campaign analytics demo: the numbers count up and the bars rise once,
 * when scrolled into view (CountUp + GrowthBars handle motion; no-JS
 * renders the finished dashboard statically).
 */
const DEMO_VIEWS = [
  8, 14, 22, 34, 51, 76, 112, 164, 238, 332, 458, 631, 869, 1284,
];

function GrowthScene() {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-line-strong" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
          SIFT · CAMPAIGN ANALYTICS
        </span>
        <span className="rounded-full bg-accent-dim px-2 py-0.5 font-mono text-[10px] text-accent">
          OPEN
        </span>
      </div>

      <div className="rounded-md border border-line p-3">
        <div className="flex flex-wrap items-baseline justify-between gap-1">
          <span className="font-mono text-[10px] tracking-wide text-faint">
            SKATE_SUMMER · TOTAL VIEWS
          </span>
          <span className="font-mono text-base font-medium text-ink">
            <CountUp value={1284000} />
          </span>
        </div>
        <GrowthBars
          className="mt-3"
          points={DEMO_VIEWS}
          labels={["AUG 11", "NOW"]}
        />
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-3">
        {[
          {
            label: "SPENT",
            node: <CountUp value={2187.4} prefix="$" decimals={2} />,
          },
          { label: "CLIPS", node: <CountUp value={47} /> },
          { label: "RATE / 1K", node: "$1.20" },
        ].map((s) => (
          <div key={s.label} className="rounded-md border border-line p-2.5">
            <dt className="font-mono text-[9px] tracking-[0.08em] text-faint">
              {s.label}
            </dt>
            <dd className="mt-0.5 font-mono text-sm font-medium text-ink">
              {s.node}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-1.5" aria-hidden>
        <div className="flex justify-between font-mono text-[10px] text-faint">
          <span>BUDGET USED</span>
          <span>$2,187.40 / $3,400.00 · 64%</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-raised">
          <div className="h-full w-[64%] rounded-full bg-accent" />
        </div>
      </div>
    </div>
  );
}

function Clip({
  tone,
  head,
  body,
}: {
  tone: "neutral" | "ok" | "err" | "accent" | "info";
  head: string;
  body: string;
}) {
  const bar = {
    neutral: "bg-line-strong",
    ok: "bg-ok",
    err: "bg-err",
    accent: "bg-accent",
    info: "bg-info",
  }[tone];

  return (
    <div className="min-w-[150px] rounded-md border border-line bg-panel px-3 py-2 text-left">
      <span className={`mb-1.5 block h-[3px] w-8 rounded-full ${bar}`} aria-hidden />
      <span className="block tracking-wide">{head}</span>
      <span className="block text-faint">{body}</span>
    </div>
  );
}

function Arrow() {
  return (
    <span
      aria-hidden
      className="grid place-items-center px-0.5 text-faint select-none"
    >
      ›
    </span>
  );
}

/*
 * Footage sources — Pexels License (free to use, CDN hotlinking).
 * 3196344: aerial city (review-room "promo" source); 4540151: podcast
 * recording (clipper source + cuts); 3571264: kitchen hands (studio
 * monitor). Cards re-crop the source vertically.
 */
const SRC_MAIN =
  "https://videos.pexels.com/video-files/3196344/3196344-hd_1920_1080_25fps.mp4";
const SRC_CARD =
  "https://videos.pexels.com/video-files/4540151/4540151-hd_1280_720_30fps.mp4";
const SRC_STUDIO =
  "https://videos.pexels.com/video-files/3571264/3571264-hd_1920_1080_30fps.mp4";

const CLIPS = [
  {
    caption: "He said what?",
    score: "92",
    preset: "HORMOZI",
    pos: "50% 25%",
  },
  {
    caption: "The hot take",
    score: "87",
    preset: "BEAST",
    pos: "35% 40%",
  },
  {
    caption: "Story time",
    score: "81",
    preset: "CLEAN",
    pos: "65% 55%",
  },
];

/*
 * Clipper workflow (16s loop): the long-form link types itself into the
 * field, Generate clips gets clicked, analyzing stages tick past while
 * skeleton slots shimmer, then the three cuts resolve with scores and
 * caption presets. Real footage in the results; tokens only; reduced
 * motion renders the finished state statically.
 */
const WF_LINK = "youtube.com/watch?v=podcast_ep142";

function ClipperScene() {
  const skelShimmer = (
    <>
      <span className="sift-wf-shimmer absolute inset-x-2 top-2 block h-1.5 rounded bg-line-strong" />
      <span className="sift-wf-shimmer absolute inset-x-2 top-5 block h-1.5 rounded bg-line-strong [animation-delay:150ms]" />
      <span className="sift-wf-shimmer absolute inset-x-6 top-[38%] block h-8 rounded bg-line-strong/60 [animation-delay:300ms]" />
    </>
  );

  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex gap-1" aria-hidden>
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-line-strong" />
          <span className="h-2 w-2 rounded-full bg-line-strong" />
        </span>
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
          SIFT · AI CLIPPER
        </span>
        <span className="relative inline-grid rounded-full bg-accent-dim px-2 py-0.5 font-mono text-[10px] text-accent">
          <span className="col-start-1 row-start-1 sift-wf-q0 opacity-0">
            QUEUE 0
          </span>
          <span className="col-start-1 row-start-1">QUEUE 3</span>
        </span>
      </div>

      {/* Step 1+2 — paste the link, hit generate */}
      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1 overflow-hidden rounded-md border border-line-strong bg-canvas px-3 py-2 font-mono text-xs">
          <span className="flex items-center gap-2">
            <video
              src={SRC_CARD}
              autoPlay
              muted
              loop
              playsInline
              preload="metadata"
              className="sift-pan h-6 w-9 shrink-0 rounded-sm border border-line object-cover"
              aria-hidden
            />
            <span className="min-w-0 truncate">
              <span className="sift-wf-typed">{WF_LINK}</span>
              <span
                className="sift-wf-caret ml-px inline-block h-3.5 w-[2px] translate-y-0.5 bg-accent opacity-0"
                aria-hidden
              />
            </span>
          </span>
        </div>
        <div
          className="relative grid h-9 w-full shrink-0 place-items-center rounded-md bg-accent px-4 text-sm font-medium text-on-accent sm:w-40"
          role="presentation"
        >
          <span className="absolute inset-0 rounded-md ring-2 ring-accent opacity-0 sift-wf-ping" aria-hidden />
          <span className="sift-wf-idle opacity-0">Generate clips</span>
          <span className="sift-wf-loading absolute flex items-center gap-2 opacity-0">
            <svg viewBox="0 0 24 24" className="h-4 w-4 animate-spin" fill="none" aria-hidden>
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity=".25" strokeWidth="3" />
              <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
            </svg>
            Analyzing…
          </span>
          <span className="sift-wf-done absolute">✓ 3 clips</span>
        </div>
      </div>

      {/* Step 3 — pipeline stages */}
      <p className="relative mt-2 h-4 font-mono text-[10px] tracking-wide text-faint" aria-hidden>
        <span className="sift-wf-status sift-wf-status-1 absolute left-0 opacity-0">
          ▸ TRANSCRIBING AUDIO
        </span>
        <span className="sift-wf-status sift-wf-status-2 absolute left-0 opacity-0">
          ▸ SCORING HIGHLIGHTS
        </span>
        <span className="sift-wf-status sift-wf-status-3 absolute left-0 opacity-0">
          ▸ CUTTING SEGMENTS
        </span>
      </p>

      {/* Step 4 — skeletons resolve into cuts */}
      <div className="mt-2 flex justify-center gap-2 sm:justify-start lg:w-40 lg:flex-col">
        {CLIPS.map((c, i) => {
          const cardCls = ["sift-wf-card-a", "sift-wf-card-b", "sift-wf-card-c"][i];
          return (
            <div
              key={c.caption}
              className="relative aspect-[9/16] w-24 shrink-0 overflow-hidden rounded-md border border-line-strong sm:w-full"
            >
              <div
                className="sift-wf-skel absolute inset-0 bg-raised p-2 opacity-0"
                aria-hidden
              >
                {skelShimmer}
              </div>
              <figure className={`absolute inset-0 ${cardCls}`}>
                <video
                  src={SRC_CARD}
                  autoPlay
                  muted
                  loop
                  playsInline
                  preload="metadata"
                  className="sift-pan absolute inset-0 h-full w-full object-cover"
                  style={{ objectPosition: c.pos }}
                />
                <figcaption
                  className="absolute inset-x-1 bottom-6 text-center text-[10px] leading-tight font-extrabold uppercase text-[#ffd23f]"
                  style={{ textShadow: "0 1px 2px rgba(0,0,0,.85)" }}
                >
                  {c.caption}
                </figcaption>
                <span className="absolute right-1 top-1 rounded bg-canvas/90 px-1 font-mono text-[10px] font-medium text-accent">
                  {c.score}
                </span>
                <span className="absolute bottom-1 left-1 font-mono text-[9px] tracking-wide text-white/85 uppercase">
                  {c.preset}
                </span>
              </figure>
            </div>
          );
        })}
      </div>

      {/* Source line under the flow */}
      <p className="mt-3 truncate font-mono text-[10px] text-faint">
        SOURCE · PODCAST_EP142.MP4 · 00:41:07
      </p>
    </div>
  );
}

/*
 * Studio loop (16s): a chat command lands, the assistant thinks,
 * block A trims while B and C slide tight, the playhead sweeps the
 * program, and the reply confirms. Final state = the applied edit.
 */
function StudioScene() {
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 animate-pulse rounded-full bg-err" aria-hidden />
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">
            SIFT · STUDIO
          </span>
        </span>
        <span className="font-mono text-[10px] text-faint">1920×1080 · 30FPS</span>
      </div>

      <div className="sift-reset-16 grid gap-3 lg:grid-cols-[minmax(0,1fr)_11rem]">
        {/* Program monitor */}
        <div className="relative overflow-hidden rounded-md border border-line">
          <video
            src={SRC_STUDIO}
            autoPlay
            muted
            loop
            playsInline
            preload="metadata"
            className="block aspect-video w-full object-cover"
          />
          <span className="absolute left-2 top-2 rounded bg-canvas/90 px-1.5 py-0.5 font-mono text-[10px] text-muted">
            PROGRAM
          </span>
        </div>

        {/* Edit chat rail */}
        <div className="flex min-h-40 flex-col gap-2">
          <p className="self-end rounded-lg rounded-br-sm bg-raised px-2.5 py-1.5 text-xs text-ink sift-ed-user">
            Tighten the intro — punchier cuts.
          </p>
          <p className="self-start px-1 text-xs tracking-widest text-faint sift-ed-dots" aria-hidden>
            ●●●
          </p>
          <p className="self-start rounded-lg rounded-bl-sm bg-accent-dim px-2.5 py-1.5 text-xs text-ink sift-ed-bot">
            Done — intro −2.4s, cuts tightened.
          </p>
          <p className="mt-auto rounded-md border border-line-strong px-2 py-1.5 font-mono text-[11px] text-faint">
            Describe an edit…
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div className="mt-3 rounded-md border border-line p-2" aria-hidden>
        <div className="mb-1 flex justify-between font-mono text-[9px] text-faint">
          <span>00:00</span>
          <span>00:04</span>
          <span>00:08</span>
          <span>00:12</span>
        </div>
        <div className="relative space-y-1.5">
          <div className="relative h-7 overflow-hidden rounded bg-raised">
            <span className="sift-ed-block-a absolute inset-y-0.5 left-0.5 w-[38%] rounded-sm bg-accent-dim">
              <span className="hidden px-1.5 py-1 font-mono text-[8px] text-accent sm:block">
                A_ROUGH
              </span>
            </span>
            <span className="sift-ed-block-b absolute inset-y-0.5 left-[39%] w-[30%] rounded-sm bg-line-strong">
              <span className="hidden px-1.5 py-1 font-mono text-[8px] text-ink sm:block">
                B_BROLL
              </span>
            </span>
            <span className="sift-ed-block-c absolute inset-y-0.5 left-[70%] w-[28%] rounded-sm bg-line-strong">
              <span className="hidden px-1.5 py-1 font-mono text-[8px] text-ink sm:block">
                C_OUTRO
              </span>
            </span>
            <span className="sift-ed-head pointer-events-none absolute inset-y-0 left-0 h-full w-full">
              <span className="absolute inset-y-[-2px] left-0 w-0.5 bg-accent" />
            </span>
          </div>
          <div className="h-4 rounded bg-raised">
            <span className="block px-1.5 py-1 font-mono text-[8px] text-faint">
              SCORE_MAST.WAV
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
