import type { Metadata } from "next";
import Link from "next/link";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import {
  deleteOrganizationAction,
  leaveOrganizationAction,
} from "@/app/actions/orgs";
import { DangerButton } from "@/components/ui/danger-button";
import { Chip } from "@/components/ui/chip";
import { RenameOrgForm } from "./rename-form";
import { BannerForm } from "./banner-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, member } = await requireOrgContext(slug);
  const supabase = await createClient();
  const isOwner = org.owner_id === member.user_id;

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </header>

      <section className="rounded-lg border border-line bg-panel p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold">Workspace</h2>
          {!isOwner && (
            <span className="font-mono text-[10px] text-faint">
              owner-only
            </span>
          )}
        </div>
        {isOwner ? (
          <RenameOrgForm
            organizationId={org.id}
            slug={slug}
            currentName={org.name}
          />
        ) : (
          <p className="text-sm">
            {org.name}{" "}
            <span className="font-mono text-[11px] text-faint">/o/{org.slug}</span>
          </p>
        )}
      </section>

      {isOwner && (
        <section className="rounded-lg border border-line bg-panel p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Banner</h2>
            <span className="font-mono text-[10px] text-faint">optional</span>
          </div>
          <BannerForm
            slug={slug}
            organizationId={org.id}
            bannerUrl={
              org.banner_path
                ? supabase.storage.from("workspace-banners").getPublicUrl(org.banner_path)
                    .data.publicUrl
                : null
            }
          />
        </section>
      )}

      <section className="rounded-lg border border-line bg-panel p-5">
        <h2 className="mb-2 text-sm font-semibold">Plan</h2>
        <div className="flex items-center gap-2">
          <Chip tone={org.plan === "free" ? "neutral" : "accent"}>
            {org.plan.toUpperCase()}
          </Chip>
          <span className="font-mono text-[11px] text-faint">
            subscription: {org.subscription_status}
          </span>
        </div>
        <p className="mt-3 max-w-lg text-xs text-muted">
          Free workspaces run up to 5 active jobs and 10 editors. Paid tiers
          raise those caps — Stripe checkout lands in the billing stage of the
          build.
        </p>
      </section>

      <section className="rounded-lg border border-err/25 bg-panel p-5">
        <h2 className="mb-1 text-sm font-semibold text-err">Danger zone</h2>
        <div className="mt-3 grid divide-y divide-line">
          {!isOwner && (
            <Row
              title="Leave this workspace"
              body="Removes your access and roles here. You can rejoin with a new invite."
            >
              <form action={leaveOrganizationAction}>
                <input type="hidden" name="organization_id" value={org.id} />
                <DangerButton label="LEAVE WORKSPACE" confirmLabel="CONFIRM LEAVE?" />
              </form>
            </Row>
          )}
          {isOwner && (
            <Row
              title="Delete this workspace"
              body="Erases every job, submission, message and role for everyone. There is no undo."
            >
              <form action={deleteOrganizationAction}>
                <input type="hidden" name="organization_id" value={org.id} />
                <DangerButton
                  label="DELETE WORKSPACE"
                  confirmLabel="TYPE-CONFIRM: CLICK AGAIN"
                  className="cursor-pointer rounded border border-err/40 px-2.5 py-1.5 font-mono text-[11px] text-err transition-colors hover:bg-err/10"
                />
              </form>
            </Row>
          )}
        </div>
      </section>

      <Link href={`/o/${slug}`} className="justify-self-start font-mono text-[11px] text-faint hover:text-accent">
        ← back to overview
      </Link>
    </div>
  );
}

function Row({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-3 first:border-t-0">
      <div className="min-w-0 max-w-md">
        <p className="text-sm">{title}</p>
        <p className="mt-0.5 text-xs text-muted">{body}</p>
      </div>
      {children}
    </div>
  );
}
