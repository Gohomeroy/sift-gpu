"use client";

import { useActionState } from "react";
import { updateProfileAction } from "@/app/actions/profile";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Textarea } from "@/components/ui/field";

export function ProfileForm({
  displayName,
  bio,
  skills,
}: {
  displayName: string;
  bio: string;
  skills: string;
}) {
  const [state, action, pending] = useActionState(updateProfileAction, emptyState);

  return (
    <form action={action} className="grid gap-4 rounded-lg border border-line bg-panel p-5">
      <Field label="Display name" htmlFor="display_name">
        <Input
          id="display_name"
          name="display_name"
          required
          minLength={2}
          maxLength={50}
          defaultValue={displayName}
        />
      </Field>
      <Field
        label="Bio"
        hint="A line or two about the work you do."
        htmlFor="bio"
      >
        <Textarea id="bio" name="bio" rows={3} defaultValue={bio} />
      </Field>
      <Field
        label="Skills"
        hint="Comma separated â€” Premiere Pro, DaVinci Resolve, After Effectsâ€¦"
        htmlFor="skills"
      >
        <Input
          id="skills"
          name="skills"
          defaultValue={skills}
          placeholder="Premiere Pro, CapCut, Sound design"
        />
      </Field>
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <Button type="submit" loading={pending} className="justify-self-start">
        Save profile
      </Button>
    </form>
  );
}
