"use client";

import { useActionState } from "react";
import { renameOrganizationAction } from "@/app/actions/orgs";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";

export function RenameOrgForm({
  organizationId,
  slug,
  currentName,
}: {
  organizationId: string;
  slug: string;
  currentName: string;
}) {
  const [state, action, pending] = useActionState(
    renameOrganizationAction,
    emptyState,
  );

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="slug" value={slug} />
      <Field label="Workspace name" htmlFor="org-name">
        <Input
          id="org-name"
          name="name"
          required
          minLength={2}
          maxLength={60}
          defaultValue={currentName}
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <Button type="submit" loading={pending} className="justify-self-start">
        Save
      </Button>
    </form>
  );
}
