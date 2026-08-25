import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/lib/org-context";
import { can } from "@/lib/permissions";
import { JobForm } from "../new/job-form";

export const metadata: Metadata = { title: "Post a job" };

export default async function NewJobPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, permissions } = await requireOrgContext(slug);

  if (!can(permissions, "post_jobs")) {
    return (
      <div className="mx-auto grid max-w-2xl gap-4">
        <p className="text-sm text-muted">
          You don&apos;t have permission to post jobs in this workspace.
        </p>
        <Link href={`/o/${slug}/jobs`} className="font-mono text-[11px] text-accent hover:underline">
          ← back to the board
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <header>
        <Link
          href={`/o/${slug}/jobs`}
          className="font-mono text-[11px] text-faint hover:text-accent"
        >
          ← job board
        </Link>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Post a job</h1>
        <p className="mt-0.5 text-sm text-muted">
          {org.plan === "free"
            ? "Free plan: up to 5 active listings at a time."
            : "Listings go live on the board the moment you publish."}
        </p>
      </header>

      <section className="rounded-lg border border-line bg-panel p-5">
        <JobForm slug={slug} organizationId={org.id} />
      </section>
    </div>
  );
}
