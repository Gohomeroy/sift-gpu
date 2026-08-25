"use client";

import { useState, useActionState } from "react";
import { createInviteAction } from "@/app/actions/invites";
import { emptyState } from "@/lib/action-state";
import { CopyButton } from "@/components/ui/copy-button";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Select } from "@/components/ui/field";

type RoleOption = { id: string; name: string; color: string };

export function InviteForm({
  organizationId,
  roles,
}: {
  organizationId: string;
  roles: RoleOption[];
}) {
  const [instance, setInstance] = useState(0);

  return (
    <InviteFormInner
      key={instance}
      organizationId={organizationId}
      roles={roles}
      onReset={() => setInstance((n) => n + 1)}
    />
  );
}

function InviteFormInner({
  organizationId,
  roles,
  onReset,
}: {
  organizationId: string;
  roles: RoleOption[];
  onReset: () => void;
}) {
  const [state, action, pending] = useActionState(createInviteAction, emptyState);
  const [submittedEmail, setSubmittedEmail] = useState<string | null>(null);

  const token = state.success?.startsWith("INVITE_TOKEN:")
    ? state.success.slice("INVITE_TOKEN:".length)
    : null;

  return (
    <form
      action={(fd) => {
        setSubmittedEmail(String(fd.get("email") ?? "").trim() || null);
        action(fd);
      }}
      className="grid gap-4"
    >
      <input type="hidden" name="organization_id" value={organizationId} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Joining role"
          hint="They can be given more roles later."
          htmlFor="role_id"
        >
          <Select id="role_id" name="role_id" required defaultValue="">
            <option value="" disabled>
              Pick a role…
            </option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Email (optional)"
          htmlFor="email"
          hint="Locks the link to this address — nothing is emailed."
        >
          <Input id="email" name="email" type="email" placeholder="editor@email.com" />
        </Field>
        <Field label="Expires" htmlFor="expires_in">
          <Select id="expires_in" name="expires_in" defaultValue="7">
            <option value="7">In 7 days</option>
            <option value="30">In 30 days</option>
            <option value="0">Never</option>
          </Select>
        </Field>
        <Field label="Max uses (optional)" htmlFor="max_uses" hint="Blank = unlimited.">
          <Input id="max_uses" name="max_uses" type="number" min={1} placeholder="e.g. 3" />
        </Field>
      </div>

      {state.error && <Alert kind="error">{state.error}</Alert>}
      {!token && (
        <Button type="submit" loading={pending} className="justify-self-start">
          Create invite
        </Button>
      )}

      {token && (
        <InviteLink
          token={token}
          email={submittedEmail}
          onReset={onReset}
        />
      )}
    </form>
  );
}

function InviteLink({
  token,
  email,
  onReset,
}: {
  token: string;
  email: string | null;
  onReset: () => void;
}) {
  return (
    <div className="rounded-md border border-ok/30 bg-ok/5 px-3 py-2.5">
      <p className="mb-1 text-xs text-muted">
        {email ? (
          <>
            Invite created for <span className="text-ink">{email}</span> — they
            must join with that address. Send them this link yourself:
          </>
        ) : (
          "Invite created — share this link:"
        )}
      </p>
      <div className="flex items-center justify-between gap-2">
        <code className="truncate font-mono text-xs text-ink">
          /invite/{token}
        </code>
        <CopyButton getValue={() => `${window.location.origin}/invite/${token}`} />
      </div>
      <div className="mt-3 flex justify-end">
        <Button variant="outline" size="sm" onClick={onReset}>
          Create another
        </Button>
      </div>
    </div>
  );
}
