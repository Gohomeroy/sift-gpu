"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";
import type { PermissionKey } from "@/lib/permissions";

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export async function createRoleAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const organizationId = String(formData.get("organization_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#f0a32b").trim();
  const permissions = formData.getAll("permissions").map(String) as PermissionKey[];

  if (name.length < 1 || name.length > 40) {
    return { error: "Role name must be 1-40 characters.", success: null };
  }
  if (!COLOR_RE.test(color)) {
    return { error: "Color must be a hex value like #f0a32b.", success: null };
  }

  const { data: role, error } = await supabase
    .from("roles")
    .insert({ organization_id: organizationId, name, color })
    .select("id")
    .single();

  if (error) return { error: error.message, success: null };

  if (permissions.length > 0) {
    const { error: permError } = await supabase
      .from("role_permissions")
      .insert(permissions.map((permission) => ({ role_id: role!.id, permission })));
    if (permError) return { error: permError.message, success: null };
  }

  revalidatePath(`/o/${slug}/roles`);
  return { error: null, success: `ROLE_CREATED:${role!.id}` };
}

export async function togglePermissionAction(formData: FormData) {
  const supabase = await createClient();
  const roleId = String(formData.get("role_id") ?? "");
  const permission = String(formData.get("permission") ?? "") as PermissionKey;
  const slug = String(formData.get("slug") ?? "");
  const enable = String(formData.get("enable") ?? "") === "true";

  if (enable) {
    await supabase
      .from("role_permissions")
      .insert({ role_id: roleId, permission });
  } else {
    await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", roleId)
      .eq("permission", permission);
  }

  revalidatePath(`/o/${slug}/roles`);
}

export async function deleteRoleAction(formData: FormData) {
  const supabase = await createClient();
  const roleId = String(formData.get("role_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  await supabase.from("roles").delete().eq("id", roleId);
  revalidatePath(`/o/${slug}/roles`);
  revalidatePath(`/o/${slug}/members`);
}
