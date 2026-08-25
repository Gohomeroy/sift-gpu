import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { OrgContext } from "@/lib/types";
import type { PermissionKey } from "@/lib/permissions";
import type { User } from "@supabase/supabase-js";

export async function getSessionUser(): Promise<User | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/sign-in");
  return user;
}

export type UserOrg = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  owner_id: string;
};

export async function getUserOrganizations(): Promise<UserOrg[]> {
  const supabase = await createClient();
  const user = await requireUser();

  const { data, error } = await supabase
    .from("organization_members")
    .select("organizations(id, name, slug, plan, owner_id)")
    .eq("user_id", user.id)
    .eq("status", "active");

  if (error) throw error;

  return ((data ?? []) as unknown as { organizations: UserOrg | null }[])
    .map((r) => r.organizations)
    .filter((o): o is UserOrg => Boolean(o));
}

/**
 * Everything an org-scoped page needs: the org, this user's membership row,
 * their unioned permission set, and the org's visible roles. Cached per request.
 */
export const getOrgContext = cache(
  async (slug: string): Promise<OrgContext | null> => {
    const supabase = await createClient();
    const user = await requireUser();

    const { data: org, error: orgErr } = await supabase
      .from("organizations")
      .select("*")
      .eq("slug", slug)
      .maybeSingle();
    if (orgErr || !org) return null;

    const { data: member } = await supabase
      .from("organization_members")
      .select("*")
      .eq("organization_id", org.id)
      .eq("user_id", user.id)
      .maybeSingle();

    // RLS hides rows from non-members; treat as not-found rather than leaking
    // that the org exists.
    if (!member || member.status !== "active") return null;

    const { data: mr } = await supabase
      .from("member_roles")
      .select("role_id, roles(id, name, color, is_system)")
      .eq("organization_member_id", member.id);

    const rows = (mr ?? []) as unknown as {
      role_id: string;
      roles: { id: string; name: string; color: string; is_system: boolean } | null;
    }[];

    const roleIds = rows.map((r) => r.role_id);

    let permissionSet = new Set<PermissionKey>();
    if (roleIds.length > 0) {
      const { data: perms } = await supabase
        .from("role_permissions")
        .select("permission")
        .in("role_id", roleIds);
      permissionSet = new Set(
        (perms ?? []).map((p) => p.permission as PermissionKey),
      );
    }

    const roles = rows
      .map((r) => r.roles)
      .filter((r): r is NonNullable<typeof r> => Boolean(r));

    // Owners hold implicit full permission at the database layer.
    if (org.owner_id === user.id) {
      permissionSet = new Set<PermissionKey>([
        "post_jobs","claim_jobs_direct","apply_to_jobs","review_submissions",
        "approve_submissions","send_chat","moderate_chat","manage_campaigns",
        "kick_users","ban_users","manage_roles","access_admin_panel","manage_billing",
      ]);
    }

    return {
      org,
      member,
      permissions: permissionSet,
      roles,
    };
  },
);

export async function requireOrgContext(slug: string): Promise<OrgContext> {
  const ctx = await getOrgContext(slug);
  if (!ctx) redirect("/onboarding");
  return ctx;
}
