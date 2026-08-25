"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function createInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const organizationId = String(formData.get("organization_id") ?? "");
  const roleId = String(formData.get("role_id") ?? "");
  const email = String(formData.get("email") ?? "").trim() || null;
  const expiryDays = Number(formData.get("expires_in") ?? 0);
  const maxUsesRaw = String(formData.get("max_uses") ?? "").trim();

  if (!organizationId || !roleId) {
    return { error: "Pick a role for this invite.", success: null };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const { data, error } = await supabase
    .from("organization_invites")
    .insert({
      organization_id: organizationId,
      role_id: roleId,
      invited_by: user.id,
      email,
      expires_at:
        expiryDays > 0
          ? new Date(Date.now() + expiryDays * 86_400_000).toISOString()
          : null,
      max_uses: maxUsesRaw ? Math.max(1, parseInt(maxUsesRaw, 10)) : null,
    })
    .select("token")
    .single();

  if (error) return { error: error.message, success: null };

  revalidatePath("/o/[slug]/invites", "page");
  return { error: null, success: `INVITE_TOKEN:${data.token}` };
}

export async function revokeInviteAction(formData: FormData) {
  const supabase = await createClient();
  const id = String(formData.get("invite_id") ?? "");
  await supabase.from("organization_invites").delete().eq("id", id);
  revalidatePath("/o/[slug]/invites", "page");
}

export async function redeemInviteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const token = String(formData.get("token") ?? "").trim();

  if (!token) return { error: "Paste an invite code or link.", success: null };

  // Accepts either the raw token or a full invite URL.
  const tokenFromUrl = token.match(/\/invite\/([a-f0-9]+)/i);
  const cleanToken = tokenFromUrl ? tokenFromUrl[1]! : token;

  const { data: slug, error } = await supabase.rpc("redeem_invite", {
    p_token: cleanToken,
  });

  if (error) return { error: error.message, success: null };

  revalidatePath("/", "layout");
  redirect(`/o/${slug}`);
}
