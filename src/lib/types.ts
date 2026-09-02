import type { PermissionKey } from "./permissions";

export type Profile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  skills: string[];
  portfolio: { title?: string; url?: string }[];
  created_at: string;
};

export type Organization = {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  plan: "free" | "pro" | "studio";
  subscription_status: string;
  settings: { join_requires_approval?: boolean };
  status: "active" | "suspended";
  banner_path: string | null;
  created_at: string;
};

export type Role = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  position: number;
  is_system: boolean;
};

export type RolePermission = {
  role_id: string;
  permission: PermissionKey;
};

export type MemberStatus = "active" | "banned";

export type OrganizationMember = {
  id: string;
  organization_id: string;
  user_id: string;
  status: MemberStatus;
  joined_at: string;
  profiles?: Pick<Profile, "id" | "display_name" | "avatar_url"> | null;
};

export type MemberRoleRow = {
  organization_member_id: string;
  role_id: string;
  organization_id: string;
  roles?: Pick<Role, "id" | "name" | "color"> | null;
};

export type OrganizationInvite = {
  id: string;
  organization_id: string;
  invited_by: string;
  role_id: string;
  email: string | null;
  token: string;
  max_uses: number | null;
  uses: number;
  expires_at: string | null;
  accepted_at: string | null;
  created_at: string;
  roles?: Pick<Role, "id" | "name" | "color"> | null;
};

export type AuditEntry = {
  id: number;
  organization_id: string;
  actor_id: string | null;
  action: string;
  target_user_id: string | null;
  details: { row?: Record<string, unknown>; by_system?: boolean };
  created_at: string;
};

export type JobStatus = "open" | "taken" | "in_review" | "completed" | "cancelled";
export type ClaimMode = "direct" | "application";

export type JobAttachment = { path: string; name: string; size?: number };

export type Job = {
  id: string;
  organization_id: string;
  title: string;
  description: string;
  category: string;
  pay_amount: string | null;
  pay_currency: string;
  pay_note: string | null;
  deadline: string | null;
  required_skills: string[];
  attachments: JobAttachment[];
  status: JobStatus;
  claim_mode: ClaimMode;
  created_by: string;
  assigned_to: string | null;
  created_at: string;
};

export type JobApplication = {
  id: string;
  job_id: string;
  organization_id: string;
  user_id: string;
  note: string | null;
  status: "pending" | "accepted" | "declined" | "withdrawn";
  created_at: string;
};

export type OrgContext = {
  org: Organization;
  member: OrganizationMember;
  /** Union of permissions across every role the current user holds here. */
  permissions: Set<PermissionKey>;
  roles: (Pick<Role, "id" | "name" | "color"> & { is_system: boolean })[];
};

export type ChatChannel = {
  id: string;
  organization_id: string;
  name: string;
  slug: string;
  topic: string | null;
  created_by: string;
  created_at: string;
};

export type ChatMessage = {
  id: string;
  channel_id: string;
  organization_id: string;
  author_id: string;
  body: string;
  edited_at: string | null;
  created_at: string;
  attachment_path: string | null;
  attachment_type: "image" | "video" | null;
  attachment_name: string | null;
  reply_to_id: string | null;
  mentions: string[];
};

export type Campaign = {
  id: string;
  organization_id: string;
  title: string;
  brief: string;
  reward_text: string | null;
  banner_path: string | null;
  rate_per_1k_views: number | null;
  max_payout_per_entry: number | null;
  budget: number | null;
  status: "open" | "closed";
  created_by: string;
  created_at: string;
};

export type CampaignEntry = {
  id: string;
  campaign_id: string;
  organization_id: string;
  submitted_by: string;
  platform: "tiktok" | "youtube" | "instagram" | "other";
  url: string;
  views: number;
  note: string | null;
  status: "pending" | "approved" | "rejected";
  linked_account_id: string | null;
  views_updated_at: string | null;
  created_at: string;
};

export type ClipJob = {
  id: string;
  organization_id: string;
  created_by: string;
  source_url: string;
  title: string;
  status: "queued" | "processing" | "completed" | "failed";
  provider: "local" | "reka";
  stage: string;
  progress: number;
  caption_style: string | null;
  clip_count: number;
  error: string | null;
  created_at: string;
  updated_at: string;
};

export type Clip = {
  id: string;
  job_id: string;
  organization_id: string;
  title: string;
  start_seconds: number | null;
  end_seconds: number | null;
  viral_score: number | null;
  caption_style: string | null;
  storage_path: string;
  caption: string | null;
  hashtags: string[] | string | null;
  reasoning: string | null;
  provider: "local" | "reka";
  created_at: string;
};

export type LinkedAccount = {
  id: string;
  user_id: string;
  platform: "tiktok" | "youtube" | "instagram" | "other";
  handle: string;
  verification_code: string;
  verified_at: string | null;
  oauth_access_token: string | null;
  oauth_refresh_token: string | null;
  oauth_expires_at: string | null;
  created_at: string;
};

export type ClipPost = {
  id: string;
  clip_id: string;
  account_id: string;
  job_id: string;
  organization_id: string;
  platform: "tiktok" | "youtube" | "instagram" | "other";
  status: "queued" | "posting" | "posted" | "failed" | "cancelled";
  caption: string | null;
  hashtags: string[] | string | null;
  platform_post_id: string | null;
  platform_url: string | null;
  error: string | null;
  posted_at: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  clip?: Clip;
  account?: LinkedAccount;
};
