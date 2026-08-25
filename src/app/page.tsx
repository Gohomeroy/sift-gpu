import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, getUserOrganizations } from "@/lib/org-context";
import { ThemeToggle } from "@/components/theme-toggle";

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

      <main className="grid flex-1 content-center gap-10 py-16">
        <section className="max-w-2xl">
          <p className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
            For editing teams
          </p>
          <h1 className="mt-4 text-4xl leading-[1.1] font-semibold tracking-[-0.02em] sm:text-5xl">
            Feedback that lands on the exact frame.
          </h1>
          <p className="mt-4 max-w-xl text-base text-muted">
            SIFT gives your agency an isolated workspace: a job board for edit
            work, Drive-link submissions with versioned revision rounds, and
            review comments pinned to the second they&apos;re about — plus a
            community for your roster.
          </p>
          <div className="mt-7 flex items-center gap-3">
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

        {/* The mechanism, as a timeline. Illustrative pass — not live data. */}
        <section
          aria-label="How a review cycle looks"
          className="overflow-x-auto pb-2"
        >
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

        <p className="font-mono text-xs text-faint">
          Free workspaces: 5 active jobs · 10 editors. Paid plans raise the caps.
        </p>
      </main>

      <footer className="flex items-center justify-between border-t border-line py-4 font-mono text-[11px] text-faint">
        <span>SIFT — the operating desk for editing teams</span>
        <span>v0.1 foundation</span>
      </footer>
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
    <div className="min-w-[150px] rounded-md border border-line bg-panel px-3 py-2">
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
