"use client";

import { useActionState } from "react";
import { applyToJobAction } from "@/app/actions/jobs";
import { emptyState } from "@/lib/action-state";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/alert";
import { Textarea } from "@/components/ui/field";

export function ApplyForm({ jobId, slug }: { jobId: string; slug: string }) {
  const [state, action, pending] = useActionState(applyToJobAction, emptyState);

  if (state.success) {
    return <Alert kind="success">{state.success}</Alert>;
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="job_id" value={jobId} />
      <input type="hidden" name="slug" value={slug} />
      <Textarea
        name="note"
        rows={3}
        placeholder="One or two lines — why you're the right editor for this."
        aria-label="Application note"
      />
      {state.error && <Alert kind="error">{state.error}</Alert>}
      <Button type="submit" loading={pending}>
        Apply
      </Button>
    </form>
  );
}
