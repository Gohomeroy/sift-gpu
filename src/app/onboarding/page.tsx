import type { Metadata } from "next";
import Link from "next/link";
import { requireUser, getUserOrganizations } from "@/lib/org-context";
import { CreateOrgForm, RedeemForm } from "./forms";

export const metadata: Metadata = { title: "Get started" };

export default async function OnboardingPage() {
  const user = await requireUser();
  const orgs = await getUserOrganizations();

  return (
    <div className="mx-auto grid min-h-dvh max-w-4xl content-start gap-8 px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-mono text-sm font-medium tracking-widest">
          SIFT<span className="sift-tick" aria-hidden />
        </Link>
        <span className="font-mono text-[11px] text-faint">
          {user.email}
        </span>
      </header>

      {orgs.length > 0 && (
        <section>
          <h1 className="text-lg font-semibold">Your workspaces</h1>
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
            {orgs.map((o) => (
              <li key={o.id}>
                <Link
                  href={`/o/${o.slug}`}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-raised"
                >
                  <span className="text-sm font-medium">{o.name}</span>
                  <span className="font-mono text-[11px] text-faint">
                    /o/{o.slug} →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-semibold">Start a workspace</h2>
          <p className="mb-4 text-xs text-muted">
            You become its Owner — your own job board, roles and roster.
          </p>
          <CreateOrgForm />
        </div>
        <div className="rounded-lg border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-semibold">Join an agency</h2>
          <p className="mb-4 text-xs text-muted">
            Redeem an invite link to join with a pre-assigned role.
          </p>
          <RedeemForm />
        </div>
      </section>
    </div>
  );
}
