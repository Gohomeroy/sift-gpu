import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { can } from "@/lib/permissions";
import type { Job, JobApplication } from "@/lib/types";
import { JobBoard } from "./board";
import { RealtimeRefresher } from "./realtime-refresher";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, permissions, member } = await requireOrgContext(slug);
  const supabase = await createClient();

  const [{ data: jobs }, { data: apps }] = await Promise.all([
    supabase
      .from("jobs")
      .select("*")
      .eq("organization_id", org.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("job_applications")
      .select("job_id, user_id, status")
      .eq("organization_id", org.id),
  ]);

  const jobList = (jobs ?? []) as unknown as Job[];
  const appList = (apps ?? []) as unknown as Pick<
    JobApplication,
    "job_id" | "user_id" | "status"
  >[];

  const appCounts: Record<string, number> = {};
  for (const a of appList) {
    if (a.status !== "pending") continue;
    appCounts[a.job_id] = (appCounts[a.job_id] ?? 0) + 1;
  }

  const myApplied = new Set(
    appList
      .filter((a) => a.user_id === member.user_id && a.status === "pending")
      .map((a) => a.job_id),
  );

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <RealtimeRefresher organizationId={org.id} tables={["jobs"]} />

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Job board</h1>
          <p className="mt-0.5 text-sm text-muted">
            Live — listings update the moment anything changes.
          </p>
        </div>
        {can(permissions, "post_jobs") && (
          <Link
            href={`/o/${slug}/jobs/new`}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
          >
            <Plus size={15} /> Post a job
          </Link>
        )}
      </header>

      <JobBoard jobs={jobList} appCounts={appCounts} myApplied={myApplied} slug={slug} />
    </div>
  );
}
