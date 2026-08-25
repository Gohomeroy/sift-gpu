"use client";

import { useMemo, useState } from "react";
import {
  kickMemberAction,
  banMemberAction,
  unbanMemberAction,
  setMemberRolesAction,
} from "@/app/actions/members";
import { DangerButton } from "@/components/ui/danger-button";
import { Avatar } from "@/components/ui/avatar";
import { RoleChip } from "@/components/ui/chip";
import { Input } from "@/components/ui/field";
import { ProfileCard } from "@/components/profile-card";
import { useOrgPresence } from "@/lib/use-presence";
import type { OrganizationMember, Role } from "@/lib/types";

type RoleLite = Pick<Role, "id" | "name" | "color">;
type Reputation = { avg: number | null; reviews: number; completed: number };
type Row = OrganizationMember & { roles: RoleLite[]; reputation: Reputation | null };

export function MemberList({
  rows,
  allRoles,
  currentUserId,
  ownerId,
  canKick,
  canBan,
  canManageRoles,
  canSend,
  slug,
  organizationId,
}: {
  rows: Row[];
  allRoles: RoleLite[];
  currentUserId: string;
  ownerId: string;
  canKick: boolean;
  canBan: boolean;
  canManageRoles: boolean;
  canSend: boolean;
  slug: string;
  organizationId: string;
}) {
  const [query, setQuery] = useState("");
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const online = useOrgPresence(organizationId, currentUserId);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      (r.profiles?.display_name ?? "").toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className="grid gap-4">
      <Input
        type="search"
        placeholder="Search members…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="max-w-xs"
        aria-label="Search members"
      />

      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
        {filtered.map((m) => {
          const name = m.profiles?.display_name ?? "Unknown";
          const self = m.user_id === currentUserId;
          const targetIsOwner = m.user_id === ownerId;

          return (
            <li key={m.id} className="px-3 py-2.5">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => !self && setProfileUserId(m.user_id)}
                  disabled={self}
                  title={self ? undefined : "View profile"}
                  className="relative shrink-0 cursor-pointer rounded-full disabled:cursor-default"
                >
                  <Avatar name={name} url={m.profiles?.avatar_url} />
                  <span
                    aria-hidden
                    className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-panel ${
                      self || online.has(m.user_id) ? "bg-ok" : "bg-line-strong"
                    }`}
                  />
                </button>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    <button
                      type="button"
                      onClick={() => !self && setProfileUserId(m.user_id)}
                      disabled={self}
                      className={`truncate disabled:cursor-default ${
                        self
                          ? "text-ink"
                          : "cursor-pointer text-ink hover:text-accent hover:underline"
                      }`}
                    >
                      {name}
                    </button>
                    {self && (
                      <span className="ml-2 font-mono text-[10px] text-faint">
                        YOU
                      </span>
                    )}
                    {targetIsOwner && (
                      <span className="ml-2 font-mono text-[10px] text-accent">
                        OWNER
                      </span>
                    )}
                  </p>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {m.roles.map((r) => (
                      <RoleChip key={r.id} name={r.name} color={r.color} />
                    ))}
                    {m.roles.length === 0 && (
                      <span className="font-mono text-[10px] text-faint">
                        no roles
                      </span>
                    )}
                  </div>
                  {m.reputation && (m.reputation.reviews > 0 || m.reputation.completed > 0) && (
                    <p className="mt-1 font-mono text-[10px] text-faint">
                      {m.reputation.avg !== null && (
                        <>
                          <span className="text-accent">★</span>{" "}
                          {m.reputation.avg.toFixed(1)}
                          {" · "}
                        </>
                      )}
                      {m.reputation.reviews} review
                      {m.reputation.reviews === 1 ? "" : "s"}
                      {" · "}
                      {m.reputation.completed} completed
                    </p>
                  )}
                </div>

                {!self && !targetIsOwner && (
                  <div className="flex shrink-0 items-center gap-1">
                    {canManageRoles && (
                      <details className="relative">
                        <summary className="cursor-pointer list-none rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-raised hover:text-accent">
                          ROLES
                        </summary>
                        <form
                          action={setMemberRolesAction}
                          className="absolute top-full right-0 z-30 mt-1 w-52 rounded-md border border-line-strong bg-overlay p-2 shadow-[0_12px_32px_rgba(0,0,0,0.45)]"
                        >
                          <input type="hidden" name="member_id" value={m.id} />
                          <input
                            type="hidden"
                            name="organization_id"
                            value={organizationId}
                          />
                          <input type="hidden" name="slug" value={slug} />
                          <fieldset className="grid gap-1">
                            {allRoles.map((r) => (
                              <label
                                key={r.id}
                                className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-muted hover:bg-raised hover:text-ink"
                              >
                                <input
                                  type="checkbox"
                                  name="role_ids"
                                  value={r.id}
                                  defaultChecked={m.roles.some(
                                    (mr) => mr.id === r.id,
                                  )}
                                  className="size-3.5 accent-accent"
                                />
                                <span
                                  aria-hidden
                                  className="size-1.5 rounded-full"
                                  style={{ backgroundColor: r.color }}
                                />
                                {r.name}
                              </label>
                            ))}
                          </fieldset>
                          <button
                            type="submit"
                            className="mt-1.5 w-full cursor-pointer rounded bg-accent px-2 py-1 text-xs font-medium text-on-accent transition-colors hover:bg-accent-hover"
                          >
                            Save roles
                          </button>
                        </form>
                      </details>
                    )}
                    {canKick && m.status !== "banned" && (
                      <form action={kickMemberAction}>
                        <input type="hidden" name="member_id" value={m.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <DangerButton label="KICK" confirmLabel="SURE?" />
                      </form>
                    )}
                    {canBan && m.status !== "banned" && (
                      <form action={banMemberAction}>
                        <input type="hidden" name="member_id" value={m.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <DangerButton label="BAN" confirmLabel="CONFIRM BAN?" />
                      </form>
                    )}
                  </div>
                )}

                {m.status === "banned" && (
                  <div className="flex shrink-0 items-center gap-1">
                    <span className="rounded border border-err/40 px-1.5 py-0.5 font-mono text-[10px] text-err">
                      BANNED
                    </span>
                    {canBan && (
                      <form action={unbanMemberAction}>
                        <input type="hidden" name="member_id" value={m.id} />
                        <input type="hidden" name="slug" value={slug} />
                        <button
                          type="submit"
                          className="cursor-pointer rounded px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-raised hover:text-ok"
                        >
                          UNBAN
                        </button>
                      </form>
                    )}
                  </div>
                )}
              </div>
            </li>
          );
        })}
        {filtered.length === 0 && (
          <li className="px-4 py-8 text-center text-xs text-muted">
            No members match “{query}”.
          </li>
        )}
      </ul>

      {profileUserId && (
        <ProfileCard
          key={profileUserId}
          open
          onClose={() => setProfileUserId(null)}
          slug={slug}
          organizationId={organizationId}
          userId={profileUserId}
          fallbackName="member"
          online={online.has(profileUserId)}
          canSend={canSend}
        />
      )}
    </div>
  );
}
