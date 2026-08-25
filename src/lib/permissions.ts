/**
 * The permission matrix — mirrored 1:1 from the `permission_key` Postgres enum.
 * UI gating ONLY. The database re-checks every action via RLS; these helpers
 * exist purely to render the right controls to the right people.
 */
export const PERMISSION_KEYS = [
  "post_jobs",
  "claim_jobs_direct",
  "apply_to_jobs",
  "review_submissions",
  "approve_submissions",
  "send_chat",
  "moderate_chat",
  "manage_campaigns",
  "kick_users",
  "ban_users",
  "manage_roles",
  "access_admin_panel",
  "manage_billing",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

type PermissionMeta = {
  label: string;
  description: string;
};

export const PERMISSION_META: Record<PermissionKey, PermissionMeta> = {
  post_jobs: {
    label: "Post jobs",
    description: "Create and edit job listings on the board.",
  },
  claim_jobs_direct: {
    label: "Claim jobs directly",
    description: "Take open direct-claim jobs without approval.",
  },
  apply_to_jobs: {
    label: "Apply to jobs",
    description: "Apply to jobs that require admin approval.",
  },
  review_submissions: {
    label: "Review submissions",
    description: "Watch submissions, leave timestamp comments, request revisions.",
  },
  approve_submissions: {
    label: "Approve submissions",
    description: "Approve work, close jobs and rate editors.",
  },
  send_chat: {
    label: "Send messages",
    description: "Post in channels their roles can access.",
  },
  moderate_chat: {
    label: "Moderate chat",
    description: "Delete messages, mute and report members.",
  },
  manage_campaigns: {
    label: "Manage campaigns",
    description: "Post clipping/UGC campaigns and approve entries.",
  },
  kick_users: {
    label: "Kick members",
    description: "Remove members — they may rejoin via a new invite.",
  },
  ban_users: {
    label: "Ban members",
    description: "Permanently block a member from this workspace.",
  },
  manage_roles: {
    label: "Manage roles & invites",
    description: "Create roles, toggle permissions, assign roles, invite people.",
  },
  access_admin_panel: {
    label: "Access admin panel",
    description: "View org settings, audit log and member management.",
  },
  manage_billing: {
    label: "Manage billing",
    description: "Change the organization's subscription plan.",
  },
};

export const PERMISSION_GROUPS: {
  group: string;
  keys: PermissionKey[];
}[] = [
  { group: "Jobs", keys: ["post_jobs", "claim_jobs_direct", "apply_to_jobs"] },
  { group: "Review", keys: ["review_submissions", "approve_submissions"] },
  { group: "Community", keys: ["send_chat", "moderate_chat"] },
  { group: "Campaigns", keys: ["manage_campaigns"] },
  { group: "Moderation", keys: ["kick_users", "ban_users"] },
  {
    group: "Administration",
    keys: ["manage_roles", "access_admin_panel", "manage_billing"],
  },
];

export function can(
  permissions: Set<PermissionKey> | undefined,
  key: PermissionKey,
): boolean {
  return permissions?.has(key) ?? false;
}
