"use client";

import { useActionState } from "react";
import { approveSubmissionAction, requestRevisionAction } from "@/app/actions/submissions";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function WorkflowButtons({
  submissionId,
  slug,
  canApprove,
}: {
  submissionId: string;
  slug: string;
  canApprove: boolean;
}) {
  const [state, action, pending] = useActionState(approveSubmissionAction, emptyState);

  return (
    <div className="grid gap-2">
      <form action={requestRevisionAction}>
        <input type="hidden" name="submission_id" value={submissionId} />
        <input type="hidden" name="slug" value={slug} />
        <Button type="submit" variant="outline" size="sm" className="w-full">
          Request revision
        </Button>
      </form>
      {canApprove && (
        <form action={action}>
          <input type="hidden" name="submission_id" value={submissionId} />
          <input type="hidden" name="slug" value={slug} />
          <Button type="submit" size="sm" loading={pending} className="w-full">
            Approve &amp; complete job
          </Button>
        </form>
      )}
      {state.error && <Alert kind="error">{state.error}</Alert>}
      {state.success && <Alert kind="success">{state.success}</Alert>}
    </div>
  );
}
