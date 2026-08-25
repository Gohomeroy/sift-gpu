import type { Metadata } from "next";
import { Fragment } from "react";
import { requireOrgContext } from "@/lib/org-context";
import { createClient } from "@/lib/supabase/server";
import { togglePermissionAction, deleteRoleAction } from "@/app/actions/roles";
import { DangerButton } from "@/components/ui/danger-button";
import { CreateRoleForm } from "./create-role-form";
import { PERMISSION_GROUPS, PERMISSION_META } from "@/lib/permissions";
import type { Role } from "@/lib/types";

export const metadata: Metadata = { title: "Roles" };

type RoleRow = Role & { perms: Set<string>; memberCount: number };

export default async function RolesPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const { org, permissions } = await requireOrgContext(slug);
  const supabase = await createClient();

  const { data: roles } = await supabase
    .from("roles")
    .select("*")
    .eq("organization_id", org.id)
    .order("position");
  const roleIds = (roles ?? []).map((r) => r.id as string);

  const [{ data: rp }, { data: mr }] = await Promise.all([
    supabase.from("role_permissions").select("role_id, permission").in("role_id", roleIds),
    supabase.from("member_roles").select("role_id").eq("organization_id", org.id),
  ]);

  const roleRows: RoleRow[] = ((roles ?? []) as Role[]).map((r) => ({
    ...r,
    perms: new Set(
      (rp ?? [])
        .filter((p) => p.role_id === r.id)
        .map((p) => p.permission as string),
    ),
    memberCount: (mr ?? []).filter((m) => m.role_id === r.id).length,
  }));

  const canManage = permissions.has("manage_roles");
  const allKeys = PERMISSION_GROUPS.flatMap((g) => g.keys);

  return (
    <div className="mx-auto grid max-w-4xl gap-8">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">
          Roles &amp; permissions
        </h1>
        <p className="mt-0.5 max-w-xl text-sm text-muted">
          Members hold multiple roles; their access is the union. The Owner
          always has everything — every other cell is yours to set.
        </p>
      </header>

      {/* Permission matrix */}
      <section className="overflow-x-auto rounded-lg border border-line bg-panel">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="sticky left-0 z-10 bg-panel px-3 py-2.5 text-left font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
                Permission
              </th>
              {roleRows.map((r) => (
                <th key={r.id} className="px-3 py-2.5 text-center align-bottom">
                  <span
                    className="mx-auto mb-1 block h-[3px] w-6 rounded-full"
                    style={{ backgroundColor: r.color }}
                    aria-hidden
                  />
                  <span className="block text-xs font-medium whitespace-nowrap">
                    {r.name}
                  </span>
                  <span className="block font-mono text-[10px] text-faint">
                    {r.memberCount} member{r.memberCount === 1 ? "" : "s"}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSION_GROUPS.map((group) => (
              <Fragment key={group.group}>
                <tr className="bg-canvas/40">
                  <td
                    colSpan={roleRows.length + 1}
                    className="border-y border-line px-3 py-1 font-mono text-[10px] tracking-[0.08em] text-faint uppercase"
                  >
                    {group.group}
                  </td>
                </tr>
                {group.keys.map((key) => (
                  <tr key={key} className="hover:bg-raised/50">
                    <td className="sticky left-0 z-10 bg-panel px-3 py-1.5">
                      <span
                        title={PERMISSION_META[key].description}
                        className="cursor-help text-xs"
                      >
                        {PERMISSION_META[key].label}
                      </span>
                    </td>
                    {roleRows.map((role) => {
                      const locked =
                        role.is_system || !canManage;
                      const on = role.perms.has(key);

                      if (locked) {
                        return (
                          <td key={`${role.id}-${key}`} className="text-center">
                            <span
                              className={
                                on
                                  ? "font-mono text-accent"
                                  : "font-mono text-faint"
                              }
                              title={
                                role.is_system
                                  ? "Owner always holds full permission"
                                  : "You can't edit roles here"
                              }
                            >
                              {on ? "●" : "○"}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td key={`${role.id}-${key}`} className="text-center">
                          <form action={togglePermissionAction}>
                            <input type="hidden" name="role_id" value={role.id} />
                            <input type="hidden" name="permission" value={key} />
                            <input type="hidden" name="slug" value={slug} />
                            <input
                              type="hidden"
                              name="enable"
                              value={on ? "false" : "true"}
                            />
                            <button
                              type="submit"
                              aria-label={`${on ? "Revoke" : "Grant"} ${PERMISSION_META[key].label} for ${role.name}`}
                              className={`cursor-pointer px-2 py-1 font-mono transition-colors ${
                                on
                                  ? "text-accent hover:text-muted"
                                  : "text-faint hover:text-accent"
                              }`}
                            >
                              {on ? "●" : "○"}
                            </button>
                          </form>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {/* Role roster with delete */}
      <section className="grid gap-2">
        <h2 className="font-mono text-[11px] tracking-[0.08em] text-muted uppercase">
          Roles in this workspace
        </h2>
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {roleRows.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: r.color }}
                />
                <span className="truncate text-sm">{r.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-faint">
                  {r.perms.size === 0
                    ? "no permissions"
                    : `${allKeys.filter((k) => r.perms.has(k)).length} of ${allKeys.length}`}
                </span>
              </div>
              {!r.is_system && canManage && (
                <form action={deleteRoleAction}>
                  <input type="hidden" name="role_id" value={r.id} />
                  <input type="hidden" name="slug" value={slug} />
                  <DangerButton label="DELETE" confirmLabel="CONFIRM DELETE?" />
                </form>
              )}
              {r.is_system && (
                <span className="font-mono text-[10px] text-faint">system</span>
              )}
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint">
          Deleting a role removes it from everyone holding it — assignments go
          with it.
        </p>
      </section>

      {canManage && (
        <section className="rounded-lg border border-line bg-panel p-5">
          <h2 className="mb-1 text-sm font-semibold">New role</h2>
          <p className="mb-4 text-xs text-muted">
            Stack them freely — an editor can be both “Senior editor” and
            “Reviewer”.
          </p>
          <CreateRoleForm organizationId={org.id} slug={slug} />
        </section>
      )}
    </div>
  );
}
