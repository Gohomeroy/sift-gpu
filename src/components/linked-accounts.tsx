"use client";

import { useState, useActionState } from "react";
import { BadgeCheck, Trash2 } from "lucide-react";
import {
  linkAccountAction,
  verifyAccountAction,
  removeLinkedAccountAction,
} from "@/app/actions/campaigns";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";

export type LinkedAccountView = {
  id: string;
  platform: string;
  handle: string;
  verification_code: string;
  verified_at: string | null;
};

const PLATFORM_LABELS: Record<string, string> = {
  tiktok: "TikTok",
  youtube: "YouTube",
  instagram: "Instagram",
  other: "Other",
};

export function LinkedAccounts({
  accounts,
}: {
  accounts: LinkedAccountView[];
}) {
  const [linkState, linkAction, linkPending] = useActionState(
    linkAccountAction,
    emptyState,
  );
  const [verifyState, verifyAction, verifyPending] = useActionState(
    verifyAccountAction,
    emptyState,
  );
  const [openAccountId] = useState<string | null>(
    linkState.success?.startsWith("ACCOUNT:")
      ? linkState.success.split(":")[1] ?? null
      : null,
  );

  const freshCode =
    linkState.success?.startsWith("ACCOUNT:")
      ? {
          id: linkState.success.split(":")[1] ?? "",
          code: linkState.success.split(":")[2] ?? "",
        }
      : null;

  return (
    <div className="grid gap-4">
      <form action={linkAction} className="grid gap-3 sm:grid-cols-[160px_1fr_auto] sm:items-end">
        <Field label="Platform" htmlFor="la-platform">
          <Select id="la-platform" name="platform" defaultValue="tiktok">
            <option value="tiktok">TikTok</option>
            <option value="youtube">YouTube</option>
            <option value="instagram">Instagram</option>
            <option value="other">Other</option>
          </Select>
        </Field>
        <Field label="Handle" htmlFor="la-handle">
          <Input id="la-handle" name="handle" required maxLength={60} placeholder="@youraccount" />
        </Field>
        <Button type="submit" size="md" loading={linkPending}>
          Link account
        </Button>
      </form>

      {linkState.error && <Alert kind="error">{linkState.error}</Alert>}

      {freshCode && (
        <div className="rounded-md border border-accent/30 bg-accent/5 px-3 py-2.5">
          <p className="text-sm text-muted">
            Prove you own this account: paste this code into its{" "}
            <span className="font-medium text-ink">bio / channel description</span>,
            save, then hit verify.
          </p>
          <p className="mt-1.5 select-all text-center font-mono text-lg font-medium tracking-[0.2em] text-accent">
            {freshCode.code}
          </p>
          {(() => {
            const target = accounts.find((a) => a.id === freshCode.id);
            if (!target) return null;
            return (
              <VerifyButton accountId={target.id} state={verifyState} pending={verifyPending} action={verifyAction} />
            );
          })()}
        </div>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
        {accounts.length === 0 && (
          <li className="px-3 py-3 text-xs text-muted">
            No linked accounts yet — link one to submit campaign entries.
          </li>
        )}
        {accounts.map((a) => {
          const isOpen = openAccountId === a.id || freshCode?.id === a.id;
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
              <Chip dot tone="neutral">
                {PLATFORM_LABELS[a.platform] ?? a.platform}
              </Chip>
              <span className="font-mono text-sm text-ink">@{a.handle}</span>
              {a.verified_at ? (
                <span className="inline-flex items-center gap-1 font-mono text-[10px] text-ok">
                  <BadgeCheck size={12} /> VERIFIED
                </span>
              ) : (
                <span className="font-mono text-[10px] text-faint">UNVERIFIED</span>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                {!a.verified_at && !isOpen && (
                  <VerifyInline accountId={a.id} pending={verifyPending} action={verifyAction} />
                )}
                <form action={removeLinkedAccountAction}>
                  <input type="hidden" name="account_id" value={a.id} />
                  <button
                    type="submit"
                    title="Unlink account"
                    aria-label={`Unlink ${a.handle}`}
                    className="cursor-pointer rounded p-1 text-faint transition-colors hover:bg-raised hover:text-err"
                  >
                    <Trash2 size={13} />
                  </button>
                </form>
              </div>

              {isOpen && !a.verified_at && (
                <div className="w-full rounded-md border border-accent/30 bg-accent/5 px-3 py-2.5">
                  <p className="text-xs text-muted">
                    Paste this code into the account&apos;s bio, save, then verify:
                  </p>
                  <p className="mt-1 select-all text-center font-mono text-lg font-medium tracking-[0.2em] text-accent">
                    {a.verification_code}
                  </p>
                  <VerifyButton accountId={a.id} state={verifyState} pending={verifyPending} action={verifyAction} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function VerifyButton({
  accountId,
  state,
  pending,
  action,
}: {
  accountId: string;
  state: { error: string | null; success: string | null };
  pending: boolean;
  action: (fd: FormData) => void;
}) {
  return (
    <div className="mt-2">
      <form action={action}>
        <input type="hidden" name="account_id" value={accountId} />
        <Button type="submit" size="sm" loading={pending}>
          Verify now
        </Button>
      </form>
      {state.error && <div className="mt-2"><Alert kind="error">{state.error}</Alert></div>}
      {state.success && <div className="mt-2"><Alert kind="success">{state.success}</Alert></div>}
    </div>
  );
}

function VerifyInline({
  accountId,
  pending,
  action,
}: {
  accountId: string;
  pending: boolean;
  action: (fd: FormData) => void;
}) {
  return (
    <form action={action}>
      <input type="hidden" name="account_id" value={accountId} />
      <Button type="submit" variant="outline" size="sm" loading={pending}>
        Verify
      </Button>
    </form>
  );
}
