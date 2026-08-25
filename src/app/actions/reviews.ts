"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function leaveReviewAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const submissionId = String(formData.get("submission_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const rating = Number(formData.get("rating") ?? 0);
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Pick a star rating first.", success: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Your session expired — sign in again.", success: null };

  // The editor is stamped server-side from the submission — never trusted
  // from the client. RLS re-verifies approval + permissions underneath.
  const { data: submission } = await supabase
    .from("submissions")
    .select("id, editor_id, organization_id")
    .eq("id", submissionId)
    .maybeSingle();
  if (!submission) {
    return { error: "You can't review this submission.", success: null };
  }

  const { error } = await supabase.from("reviews").upsert(
    {
      submission_id: submissionId,
      organization_id: submission.organization_id,
      reviewer_id: user.id,
      editor_id: submission.editor_id,
      rating,
      note,
    },
    { onConflict: "submission_id" },
  );

  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}/submissions/${submissionId}`);
  revalidatePath(`/o/${slug}/members`);
  return { error: null, success: "reviewed" };
}
