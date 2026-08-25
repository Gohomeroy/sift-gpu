"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function setAvatarAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const path = String(formData.get("path") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  // Path must live in the caller's own avatars folder (bucket policy enforces
  // the same rule on upload).
  if (!path.startsWith(`${user.id}/`)) {
    return { error: "Invalid avatar path.", success: null };
  }

  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: data.publicUrl })
    .eq("id", user.id);
  if (error) return { error: error.message, success: null };

  revalidatePath("/", "layout");
  return { error: null, success: "Photo updated." };
}

export async function removeAvatarAction(): Promise<ActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const { error } = await supabase
    .from("profiles")
    .update({ avatar_url: null })
    .eq("id", user.id);
  if (error) return { error: error.message, success: null };

  revalidatePath("/", "layout");
  return { error: null, success: "Photo removed." };
}

export async function setBannerAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const path = String(formData.get("path") ?? "");
  const slug = String(formData.get("slug") ?? "");

  // RLS: only the owner can update the organization row.
  const { error } = await supabase
    .from("organizations")
    .update({ banner_path: path })
    .eq("slug", slug);
  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}`, "layout");
  return { error: null, success: "Banner updated." };
}

export async function removeBannerAction(formData: FormData) {
  const supabase = await createClient();
  const slug = String(formData.get("slug") ?? "");

  await supabase
    .from("organizations")
    .update({ banner_path: null })
    .eq("slug", slug);

  revalidatePath(`/o/${slug}`, "layout");
}
