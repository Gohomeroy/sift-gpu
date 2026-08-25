"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Chip } from "@/components/ui/chip";
import { EmptyState } from "@/components/ui/empty";
import { Input, Select } from "@/components/ui/field";
import { formatJobPay, deadlineLabel } from "@/lib/utils";
import type { Job, JobStatus } from "@/lib/types";

const STATUS_TONE: Record<JobStatus, "ok" | "info" | "accent" | "neutral" | "err"> = {
  open: "ok",
  taken: "info",
  in_review: "accent",
  completed: "neutral",
  cancelled: "err",
};

const TABS: (JobStatus | "all")[] = [
  "all",
  "open",
  "taken",
  "in_review",
  "completed",
  "cancelled",
];

export function JobBoard({
  jobs,
  appCounts,
  myApplied,
  slug,
}: {
  jobs: Job[];
  appCounts: Record<string, number>;
  myApplied: Set<string>;
  slug: string;
}) {
  const [tab, setTab] = useState<JobStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [sort, setSort] = useState("newest");

  const categories = useMemo(
    () => [...new Set(jobs.map((j) => j.category))].sort(),
    [jobs],
  );

  const visible = useMemo(() => {
    let list = jobs;
    if (tab !== "all") list = list.filter((j) => j.status === tab);
    if (category !== "all") list = list.filter((j) => j.category === category);
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (j) =>
          j.title.toLowerCase().includes(q) ||
          j.required_skills.some((s) => s.toLowerCase().includes(q)),
      );
    }
    const byDeadline = (a: Job, b: Job) => {
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return +new Date(a.deadline) - +new Date(b.deadline);
    };
    switch (sort) {
      case "deadline":
        return [...list].sort(byDeadline);
      case "pay":
        return [...list].sort(
          (a, b) => (parseFloat(b.pay_amount ?? "0") || 0) - (parseFloat(a.pay_amount ?? "0") || 0),
        );
      default:
        return [...list].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
    }
  }, [jobs, tab, category, query, sort]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: jobs.length };
    for (const j of jobs) c[j.status] = (c[j.status] ?? 0) + 1;
    return c;
  }, [jobs]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`cursor-pointer rounded-full border px-2.5 py-1 font-mono text-[11px] transition-colors duration-150 ${
                tab === t
                  ? "border-accent bg-accent/10 text-accent"
                  : "border-line text-muted hover:border-line-strong hover:text-ink"
              }`}
            >
              {t === "all" ? "ALL" : t.replace("_", " ").toUpperCase()}
              <span className="ml-1.5 text-faint">{counts[t] ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Input
            type="search"
            placeholder="Search title or skill…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-48 text-xs"
            aria-label="Search jobs"
          />
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-8 w-auto text-xs"
            aria-label="Filter by category"
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
          <Select
            value={sort}
            onChange={(e) => setSort(e.target.value)}
            className="h-8 w-auto text-xs"
            aria-label="Sort jobs"
          >
            <option value="newest">Newest</option>
            <option value="deadline">Deadline soonest</option>
            <option value="pay">Pay high → low</option>
          </Select>
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title={jobs.length === 0 ? "No jobs posted yet" : "Nothing matches these filters"}
          hint={
            jobs.length === 0
              ? "The first listing sets the tone — include the brief details editors need."
              : undefined
          }
        />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {visible.map((job) => (
            <li key={job.id}>
              <Link
                href={`/o/${slug}/jobs/${job.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3 py-3 transition-colors hover:bg-raised sm:grid-cols-[minmax(0,1fr)_auto_auto_auto]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {job.title}
                    {myApplied.has(job.id) && job.status === "open" && (
                      <span className="ml-2 font-mono text-[10px] text-info">
                        APPLIED
                      </span>
                    )}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-faint uppercase">
                      {job.category}
                    </span>
                    {job.required_skills.slice(0, 3).map((s) => (
                      <span
                        key={s}
                        className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10px] text-muted"
                      >
                        {s}
                      </span>
                    ))}
                    {job.claim_mode === "direct" && job.status === "open" && (
                      <span className="rounded border border-accent-dim px-1.5 py-0.5 font-mono text-[10px] text-accent">
                        instant claim
                      </span>
                    )}
                  </div>
                </div>

                <Chip tone={STATUS_TONE[job.status]} className="justify-self-start sm:justify-self-center">
                  {job.status.replace("_", " ")}
                </Chip>

                <span className="hidden justify-self-end font-mono text-xs text-muted sm:block">
                  {formatJobPay(job)}
                </span>
                <span className="hidden justify-self-end font-mono text-[11px] text-faint lg:block">
                  {appCounts[job.id]
                    ? `${appCounts[job.id]} applicant${appCounts[job.id] === 1 ? "" : "s"}`
                    : deadlineLabel(job.deadline)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
