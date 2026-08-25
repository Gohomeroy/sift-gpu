"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { type ActionState } from "@/lib/action-state";

function jobsPaths(slug: string, jobId?: string) {
  const base = [`/o/${slug}/jobs`, `/o/${slug}`];
  return jobId ? [...base, `/o/${slug}/jobs/${jobId}`] : base;
}

export async function createJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const slug = String(formData.get("slug") ?? "");
  const attachmentsRaw = String(formData.get("attachments") ?? "[]");

  let attachments: unknown = [];
  try {
    attachments = JSON.parse(attachmentsRaw);
  } catch {
    return { error: "Attachment data was corrupted — try again.", success: null };
  }

  const title = String(formData.get("title") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const payAmountRaw = String(formData.get("pay_amount") ?? "").trim();
  const payCurrency = String(formData.get("pay_currency") ?? "USD");
  const payNote = String(formData.get("pay_note") ?? "").trim() || null;
  const deadline = String(formData.get("deadline") ?? "").trim();
  const claimMode = String(formData.get("claim_mode") ?? "application");
  const skills = String(formData.get("required_skills") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 15);

  if (title.length < 3 || title.length > 120) {
    return { error: "Title must be 3-120 characters.", success: null };
  }
  if (!category) {
    return { error: "Pick a category.", success: null };
  }
  if (claimMode !== "direct" && claimMode !== "application") {
    return { error: "Invalid claim mode.", success: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const { data: org } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!org) return { error: "Workspace not found.", success: null };

  // Plan gating (free tier cap) enforced app-side; RLS still guards everything.
  const { data: gate } = await supabase.rpc("org_within_job_limits", {
    p_org: org.id,
  });
  if (gate === false) {
    return {
      error:
        "Free plan allows 5 active job listings. Complete or cancel one first.",
      success: null,
    };
  }

  const { data: inserted, error } = await supabase
    .from("jobs")
    .insert({
      organization_id: org.id,
      title,
      description,
      category,
      pay_amount: payAmountRaw ? parseFloat(payAmountRaw) : null,
      pay_currency: payCurrency,
      pay_note: payNote,
      deadline: deadline ? new Date(deadline).toISOString() : null,
      required_skills: skills,
      claim_mode: claimMode,
      created_by: user.id,
      attachments,
    })
    .select("id")
    .single();

  if (error) return { error: error.message, success: null };
  if (!inserted) {
    return { error: "Job vanished on save — try again.", success: null };
  }

  jobsPaths(slug).forEach((p) => revalidatePath(p));
  redirect(`/o/${slug}/jobs/${inserted.id}`);
}

export async function claimJobAction(formData: FormData) {
  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase.rpc("claim_job", { p_job_id: jobId });
  jobsPaths(slug, jobId).forEach((p) => revalidatePath(p));
}

export async function applyToJobAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const note = String(formData.get("note") ?? "").trim() || null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const { data: job } = await supabase
    .from("jobs")
    .select("organization_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return { error: "Job not found.", success: null };

  const { error } = await supabase.from("job_applications").insert({
    job_id: jobId,
    organization_id: job.organization_id,
    user_id: user.id,
    note,
  });

  if (error) return { error: error.message, success: null };

  jobsPaths(slug, jobId).forEach((p) => revalidatePath(p));
  return { error: null, success: "Application sent." };
}

export async function withdrawApplicationAction(formData: FormData) {
  const supabase = await createClient();
  const applicationId = String(formData.get("application_id") ?? "");
  const jobId = String(formData.get("job_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase
    .from("job_applications")
    .update({ status: "withdrawn" })
    .eq("id", applicationId);

  jobsPaths(slug, jobId).forEach((p) => revalidatePath(p));
}

export async function assignApplicantAction(formData: FormData) {
  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  // Guarded by RLS (review_submissions) + status guard makes double-assign a no-op.
  const { data: updated, error } = await supabase
    .from("jobs")
    .update({ status: "taken", assigned_to: userId })
    .eq("id", jobId)
    .eq("status", "open")
    .select("id");

  if (!error && updated && updated.length > 0) {
    await supabase
      .from("job_applications")
      .update({ status: "accepted" })
      .eq("job_id", jobId)
      .eq("user_id", userId)
      .eq("status", "pending");
    await supabase
      .from("job_applications")
      .update({ status: "declined" })
      .eq("job_id", jobId)
      .neq("user_id", userId)
      .eq("status", "pending");
  }

  jobsPaths(slug, jobId).forEach((p) => revalidatePath(p));
}

export async function setJobStatusAction(formData: FormData) {
  const supabase = await createClient();
  const jobId = String(formData.get("job_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!["open", "cancelled"].includes(status)) return;

  await supabase.from("jobs").update({ status }).eq("id", jobId);

  jobsPaths(slug, jobId).forEach((p) => revalidatePath(p));
}
