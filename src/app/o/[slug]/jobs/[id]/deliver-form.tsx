"use client";

import { useActionState } from "react";
import { deliverSubmissionAction } from "@/app/actions/submissions";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Field, Input, Textarea } from "@/components/ui/field";

export function DeliverForm({
  jobId,
  slug,
  revisionCount = 0,
}: {
  jobId: string;
  slug: string;
  revisionCount?: number;
}) {
  const [state, action, pending] = useActionState(deliverSubmissionAction, emptyState);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="slug" value={slug} />

      <Field
        label={revisionCount > 0 ? `Delivery v-next (round ${revisionCount + 1})` : "Google Drive link"}
        hint="Share the file as “Anyone with the link → Viewer” — we verify access before accepting."
        htmlFor={`drive-${jobId}`}
      >
        <Input
          id={`drive-${jobId}`}
          name="drive_link"
          required
          type="url"
          placeholder="https://drive.google.com/file/d/…/view?usp=sharing"
          className="font-mono text-xs"
        />
      </Field>
      <Field label="Note for the reviewer (optional)" htmlFor={`note-${jobId}`}>
        <Textarea
          id={`note-${jobId}`}
          name="note"
          rows={2}
          placeholder="Export settings, what changed, anything they should know."
          className="resize-none"
        />
      </Field>

      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending}>
        {revisionCount > 0 ? `Deliver v${revisionCount + 1}` : "Deliver for review"}
      </Button>
    </form>
  );
}
