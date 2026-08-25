"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

function slugPaths(slug: string) {
  return [
    `/o/${slug}`,
    `/o/${slug}/members`,
    `/o/${slug}/roles`,
    `/o/${slug}/invites`,
  ];
}

export async function kickMemberAction(formData: FormData) {
  const supabase = await createClient();
  const memberId = String(formData.get("member_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await supabase.from("organization_members").delete().eq("id", memberId);
  slugPaths(slug).forEach((p) => revalidatePath(p));
}

export async function banMemberAction(formData: FormData) {
  const supabase = await createClient();
  const memberId = String(formData.get("member_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await supabase
    .from("organization_members")
    .update({ status: "banned" })
    .eq("id", memberId);
  slugPaths(slug).forEach((p) => revalidatePath(p));
}

export async function unbanMemberAction(formData: FormData) {
  const supabase = await createClient();
  const memberId = String(formData.get("member_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await supabase
    .from("organization_members")
    .update({ status: "active" })
    .eq("id", memberId);
  slugPaths(slug).forEach((p) => revalidatePath(p));
}

export async function setMemberRolesAction(formData: FormData) {
  const supabase = await createClient();
  const memberId = String(formData.get("member_id") ?? "");
  const orgId = String(formData.get("organization_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const selectedIds = formData.getAll("role_ids").map(String);

  // Sync strategy guarded by RLS on both sides: remove what's gone, add what's new.
  const { data: current } = await supabase
    .from("member_roles")
    .select("role_id")
    .eq("organization_member_id", memberId);

  const currentIds = new Set((current ?? []).map((r) => r.role_id));
  const targetIds = new Set(selectedIds);

  const toRemove = [...currentIds].filter((id) => !targetIds.has(id));
  const toAdd = [...targetIds].filter(
    (id) => !currentIds.has(id),
  );

  if (toRemove.length > 0) {
    await supabase
      .from("member_roles")
      .delete()
      .eq("organization_member_id", memberId)
      .in("role_id", toRemove);
  }

  if (toAdd.length > 0) {
    await supabase.from("member_roles").insert(
      toAdd.map((roleId) => ({
        organization_member_id: memberId,
        role_id: roleId,
        organization_id: orgId,
      })),
    );
  }

  slugPaths(slug).forEach((p) => revalidatePath(p));
}
