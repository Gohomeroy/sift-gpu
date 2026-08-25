"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionUser } from "@/lib/org-context";
import { parseDriveFileId, verifyPublicAccess } from "@/lib/drive";
import { type ActionState } from "@/lib/action-state";

export async function deliverSubmissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const url = String(formData.get("drive_link") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;

  if (!url) return { error: "Paste your Google Drive link.", success: null };

  const fileId = parseDriveFileId(url);
  if (!fileId) {
    return {
      error:
        "That isn't a recognisable Drive file link. Use “Share → Copy link” on the file itself.",
      success: null,
    };
  }

  const check = await verifyPublicAccess(fileId);
  if (!check.ok && check.reason?.includes("isn't publicly shared")) {
    // Hard failures block delivery; soft ones (timeouts) pass through unverified.
    return { error: check.reason, success: null };
  }

  const { data: submissionId, error } = await supabase.rpc("submit_drive_link", {
    p_job_id: jobId,
    p_url: url,
    p_note: note,
    p_verified: check.ok,
  });

  if (error) return { error: error.message, success: null };

  [
    `/o/${slug}/jobs/${jobId}`,
    `/o/${slug}/jobs`,
    `/o/${slug}`,
    `/o/${slug}/submissions/${submissionId}`,
  ].forEach((p) => revalidatePath(p));

  redirect(`/o/${slug}/submissions/${submissionId}`);
}

export async function requestRevisionAction(formData: FormData) {
  const supabase = await createClient();
  const submissionId = String(formData.get("submission_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase.rpc("request_revision", { p_submission_id: submissionId });
  revalidatePath(`/o/${slug}/submissions/${submissionId}`);
}

export async function approveSubmissionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const submissionId = String(formData.get("submission_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  const { error } = await supabase.rpc("approve_submission", {
    p_submission_id: submissionId,
  });
  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}/submissions/${submissionId}`);
  return { error: null, success: "Approved — job completed. Nice one." };
}

export async function addCommentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const versionId = String(formData.get("version_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const submissionId = String(formData.get("submission_id") ?? "");
  const body = String(formData.get("body") ?? "").trim();
  const tsRaw = String(formData.get("timestamp") ?? "").trim();

  if (!body) return { error: "Write the note first.", success: null };

  let timestampSeconds: number | null = null;
  if (tsRaw) {
    const parts = tsRaw.split(":").map(Number);
    timestampSeconds =
      parts.length === 2
        ? parts[0]! * 60 + parts[1]!
        : parts.length === 1
          ? parts[0]!
          : null;
    if (timestampSeconds === null || Number.isNaN(timestampSeconds)) {
      return { error: "That timestamp didn't parse.", success: null };
    }
  }

  const user = await getSessionUser();
  if (!user) return { error: "Your session expired — sign in again.", success: null };

  // RLS only shows the version to review participants, so this lookup is the
  // authorization check and gives us the org id the row requires.
  const { data: version } = await supabase
    .from("submission_versions")
    .select("organization_id")
    .eq("id", versionId)
    .maybeSingle();
  if (!version) {
    return { error: "You're not part of this review.", success: null };
  }

  const { error } = await supabase.from("comments").insert({
    version_id: versionId,
    organization_id: version.organization_id,
    author_id: user.id,
    body,
    timestamp_seconds: timestampSeconds,
  });
  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}/submissions/${submissionId}`);
  return { error: null, success: "posted" };
}

export async function toggleCommentResolvedAction(formData: FormData) {
  const supabase = await createClient();
  const commentId = String(formData.get("comment_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const submissionId = String(formData.get("submission_id") ?? "");
  const resolved = String(formData.get("resolved") ?? "false") === "true";

  await supabase.from("comments").update({ resolved }).eq("id", commentId);

  revalidatePath(`/o/${slug}/submissions/${submissionId}`);
}
