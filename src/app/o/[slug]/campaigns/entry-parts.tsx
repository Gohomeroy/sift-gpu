"use client";

import { useState, useActionState } from "react";
import {
  submitEntryAction,
  setEntryStatusAction,
  deleteEntryAction,
  refreshEntryViewsAction,
} from "@/app/actions/campaigns";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import { DangerButton } from "@/components/ui/danger-button";
import type { CampaignEntry } from "@/lib/types";

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  other: "Other",
};

export function EntryForm({
  slug,
  campaignId,
  accounts,
}: {
  slug: string;
  campaignId: string;
  accounts: {
    id: string;
    platform: string;
    handle: string;
    verified_at: string | null;
  }[];
}) {
  const [state, action, pending] = useActionState(submitEntryAction, emptyState);
  const verified = accounts.filter((a) => a.verified_at);

  if (verified.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line px-4 py-4 text-center">
        <p className="text-sm text-muted">
          You need a <span className="font-medium text-ink">verified linked account</span> to
          submit entries.
        </p>
        <a
          href="/profile"
          className="mt-2 inline-flex h-9 items-center rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
        >
          Link & verify an account
        </a>
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-4 rounded-lg border border-line bg-panel p-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="campaign_id" value={campaignId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Linked account"
          hint="Only verified accounts can submit."
          htmlFor="e-account"
        >
          <Select id="e-account" name="linked_account_id" required>
            {verified.map((a) => (
              <option key={a.id} value={a.id}>
                {PLATFORM_LABELS[a.platform] ?? a.platform} — @{a.handle}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Platform" htmlFor="e-platform" hint="Must match the linked account.">
          <Select id="e-platform" name="platform" defaultValue="tiktok">
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="instagram">Instagram</option>
            <option value="other">Other</option>
          </Select>
        </Field>
      </div>

      <Field label="Clip link" htmlFor="e-url">
        <Input
          id="e-url"
          name="url"
          type="url"
          required
          placeholder="https://www.tiktok.com/@you/video/…"
        />
      </Field>

      <Field label="Note (optional)" htmlFor="e-note">
        <Textarea id="e-note" name="note" rows={2} maxLength={500} placeholder="Anything the reviewer should know…" />
      </Field>

      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}

      <Button type="submit" loading={pending} className="justify-self-start">
        Submit entry
      </Button>
    </form>
  );
}

export function EntryRow({
  entry,
  submitterName,
  isOwn,
  canManage,
  slug,
  payout,
  accountHandle,
}: {
  entry: CampaignEntry;
  submitterName: string;
  isOwn: boolean;
  canManage: boolean;
  slug: string;
  payout: number | null;
  accountHandle: string | null;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Chip dot tone="neutral">
          {PLATFORM_LABELS[entry.platform] ?? entry.platform}
        </Chip>
        <a
          href={entry.url}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 max-w-xs truncate text-sm text-accent hover:underline"
        >
          {entry.url}
        </a>
        <span className="font-mono text-[11px] text-muted">
          {entry.views.toLocaleString()} views
          {payout !== null && (
            <span className="ml-2 text-ok">${payout.toFixed(2)}</span>
          )}
        </span>
        {accountHandle && (
          <span className="font-mono text-[10px] text-faint">@{accountHandle}</span>
        )}
        <Chip
          dot
          tone={
            entry.status === "approved"
              ? "ok"
              : entry.status === "rejected"
                ? "err"
                : "info"
          }
        >
          {entry.status}
        </Chip>
        <span className="font-mono text-[10px] text-faint">{submitterName}</span>

        <div className="ml-auto flex items-center gap-1">
          {canManage && (
            <form action={refreshEntryViewsAction}>
              <input type="hidden" name="entry_id" value={entry.id} />
              <input type="hidden" name="campaign_id" value={entry.campaign_id} />
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                title="Refresh view count"
                className="cursor-pointer rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-raised hover:text-accent"
              >
                ↻ VIEWS
              </button>
            </form>
          )}
          {isOwn && entry.status === "pending" && (
            <form action={deleteEntryAction}>
              <input type="hidden" name="entry_id" value={entry.id} />
              <input type="hidden" name="campaign_id" value={entry.campaign_id} />
              <input type="hidden" name="slug" value={slug} />
              <DangerButton label="WITHDRAW" confirmLabel="CONFIRM?" />
            </form>
          )}
          {canManage && entry.status !== "approved" && (
            <form action={setEntryStatusAction}>
              <input type="hidden" name="entry_id" value={entry.id} />
              <input type="hidden" name="campaign_id" value={entry.campaign_id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="status" value="approved" />
              <button
                type={confirming ? "submit" : "button"}
                onClick={() => !confirming && setConfirming(true)}
                onBlur={() => setConfirming(false)}
                className={`cursor-pointer rounded px-2 py-1 font-mono text-[11px] transition-colors ${
                  confirming
                    ? "bg-ok/10 text-ok"
                    : "text-muted hover:bg-raised hover:text-ok"
                }`}
              >
                {confirming ? "CONFIRM APPROVE?" : "APPROVE"}
              </button>
            </form>
          )}
          {canManage && entry.status === "pending" && (
            <form action={setEntryStatusAction}>
              <input type="hidden" name="entry_id" value={entry.id} />
              <input type="hidden" name="campaign_id" value={entry.campaign_id} />
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="status" value="rejected" />
              <DangerButton label="REJECT" confirmLabel="SURE?" />
            </form>
          )}
        </div>
      </div>
      {entry.note && <p className="mt-1 text-xs text-muted">{entry.note}</p>}
    </li>
  );
}
