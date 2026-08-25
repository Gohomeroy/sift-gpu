"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export async function createOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "")
    .trim()
    .toLowerCase();

  if (!SLUG_RE.test(slug)) {
    return {
      error:
        "Slug may only contain lowercase letters, numbers and single hyphens.",
      success: null,
    };
  }

  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: name,
    p_slug: slug,
  });

  if (error) return { error: error.message, success: null };

  const { data: org } = await supabase
    .from("organizations")
    .select("slug")
    .eq("id", orgId)
    .single();

  revalidatePath("/", "layout");
  redirect(`/o/${org?.slug ?? slug}`);
}

export async function leaveOrganizationAction(formData: FormData) {
  const supabase = await createClient();
  const orgId = String(formData.get("organization_id") ?? "");

  await supabase.rpc("leave_organization", { p_org: orgId });

  revalidatePath("/", "layout");
  redirect("/onboarding");
}

export async function renameOrganizationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const organizationId = String(formData.get("organization_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (name.length < 2 || name.length > 60) {
    return { error: "Workspace name must be 2-60 characters.", success: null };
  }

  // RLS: owners only.
  const { error } = await supabase
    .from("organizations")
    .update({ name })
    .eq("id", organizationId);

  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}`, "layout");
  return { error: null, success: "Workspace renamed." };
}

export async function deleteOrganizationAction(formData: FormData) {
  const supabase = await createClient();
  const organizationId = String(formData.get("organization_id") ?? "");

  // Cascades wipe every tenant row for this org. Owner-only by RLS.
  await supabase.from("organizations").delete().eq("id", organizationId);

  revalidatePath("/", "layout");
  redirect("/onboarding");
}
