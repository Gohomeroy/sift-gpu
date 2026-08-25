"use client";

import { useActionState } from "react";
import { createRoleAction } from "@/app/actions/roles";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input } from "@/components/ui/field";
import { PERMISSION_GROUPS } from "@/lib/permissions";

export function CreateRoleForm({
  organizationId,
  slug,
}: {
  organizationId: string;
  slug: string;
}) {
  const [state, action, pending] = useActionState(createRoleAction, emptyState);

  return (
    <form action={action} className="grid gap-4">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="slug" value={slug} />

      <div className="grid grid-cols-[1fr_auto] items-end gap-3">
        <Field label="Role name" htmlFor="role-name">
          <Input
            id="role-name"
            name="name"
            required
            minLength={1}
            maxLength={40}
            placeholder="Senior editor"
          />
        </Field>
        <Field label="Color" htmlFor="role-color">
          <input
            id="role-color"
            type="color"
            name="color"
            defaultValue="#58a6ff"
            className="h-9 w-16 cursor-pointer rounded-md border border-line bg-panel p-1"
          />
        </Field>
      </div>

      <fieldset>
        <legend className="mb-2 text-xs font-medium tracking-wide text-muted">
          Permissions
        </legend>
        <div className="grid gap-3 rounded-md border border-line bg-canvas/50 p-3 sm:grid-cols-2">
          {PERMISSION_GROUPS.map((g) => (
            <div key={g.group}>
              <p className="mb-1 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
                {g.group}
              </p>
              <div className="grid gap-0.5">
                {g.keys.map((k) => (
                  <label
                    key={k}
                    className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-muted transition-colors hover:bg-raised hover:text-ink"
                  >
                    <input
                      type="checkbox"
                      name="permissions"
                      value={k}
                      className="size-3.5 accent-accent"
                    />
                    {k.replaceAll("_", " ")}
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </fieldset>

      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending} className="justify-self-start">
        Create role
      </Button>
    </form>
  );
}
