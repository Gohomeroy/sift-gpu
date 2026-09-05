"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function createClipJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const slug = String(formData.get("slug") ?? "");
  const sourceUrl = String(formData.get("source_url") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();
  const captionStyle = String(formData.get("caption_style") ?? "hormozi");
  const clipCount = Math.max(1, Math.min(10, Number(formData.get("clip_count")) || 3));

  if (!sourceUrl.startsWith("http")) {
    return { error: "Paste the full https link to the long-form video.", success: null };
  }
  if (title.length < 3) {
    return { error: "Give the job a title (3+ characters).", success: null };
  }

  const { data: jobId, error } = await supabase.rpc("create_clip_job", {
    p_org: formData.get("organization_id"),
    p_source_url: sourceUrl,
    p_title: title,
    p_caption_style: captionStyle,
    p_clip_count: clipCount,
  });

  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}/clipper`);
  return { error: null, success: `JOB:${jobId}` };
}

export async function deleteClipJobAction(formData: FormData) {
  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase.rpc("delete_clip_job", { p_job: jobId });

  revalidatePath(`/o/${slug}/clipper`);
}
