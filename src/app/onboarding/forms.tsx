"use client";

import { useActionState, useState } from "react";
import { createOrganizationAction } from "@/app/actions/orgs";
import { redeemInviteAction } from "@/app/actions/invites";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";

function slugify(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function CreateOrgForm() {
  const [state, action, pending] = useActionState(
    createOrganizationAction,
    emptyState,
  );
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);

  const effectiveSlug = slugTouched ? slug : slugify(name);

  return (
    <form action={action} className="grid gap-4">
      <Field label="Workspace name" htmlFor="org-name">
        <Input
          id="org-name"
          name="name"
          required
          minLength={2}
          maxLength={60}
          placeholder="Traxn Studios"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field
        label="URL slug"
        hint={`sift.app/o/${effectiveSlug || "your-studio"}`}
        htmlFor="org-slug"
      >
        <Input
          id="org-slug"
          name="slug"
          required
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          placeholder="traxn-studios"
          value={effectiveSlug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending}>
        Create workspace
      </Button>
    </form>
  );
}

export function RedeemForm() {
  const [state, action, pending] = useActionState(redeemInviteAction, emptyState);

  return (
    <form action={action} className="grid gap-4">
      <Field
        label="Invite link or code"
        hint="Paste the link an admin shared with you."
        htmlFor="token"
      >
        <Input
          id="token"
          name="token"
          required
          placeholder="https://â€¦/invite/â€¦ or the raw code"
          className="font-mono text-xs"
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" variant="outline" loading={pending}>
        Join workspace
      </Button>
    </form>
  );
}
