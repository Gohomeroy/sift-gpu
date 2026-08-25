"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function updateProfileAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const displayName = String(formData.get("display_name") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim() || null;
  const skillsRaw = String(formData.get("skills") ?? "");
  const skills = skillsRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);

  if (displayName.length < 2 || displayName.length > 50) {
    return { error: "Display name must be 2-50 characters.", success: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: displayName, bio, skills })
    .eq("id", user.id);

  if (error) return { error: error.message, success: null };

  revalidatePath("/profile");
  return { error: null, success: "Profile saved." };
}
