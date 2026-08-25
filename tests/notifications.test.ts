/**
 * Notifications tests — runs against the live project.
 * Requires .env.local with Supabase keys and migrations 0001–0014 applied.
 * Covers: trigger wiring for all four events, self-notification suppression,
 * and RLS (own rows only, own-row read marking).
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const d = describe.skipIf(!URL || !ANON || !SERVICE);

let admin: SupabaseClient;
const createdUsers: string[] = [];
const suffix = Date.now().toString(36);
const PASSWORD = "sift-notif-test-123";
const DRIVE_LINK =
  "https://drive.google.com/file/d/11xN9tnL8RriFTPNeu05JvE6i3Dc_wMc8/view?usp=sharing";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-notif-${label}-${suffix}@test.example`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `${label} ${suffix}` },
  });
  const user = data?.user;
  if (!user) throw new Error("createUser failed");
  createdUsers.push(user.id);

  const client = userClient();
  await client.auth.signInWithPassword({ email, password: PASSWORD });
  return { id: user.id, client };
}

async function inviteAndJoin(
  owner: { id: string; client: SupabaseClient },
  orgId: string,
  roleName: string,
  user: { id: string; client: SupabaseClient },
) {
  const { data: role } = await owner.client
    .from("roles")
    .select("id")
    .eq("organization_id", orgId)
    .eq("name", roleName)
    .single();
  expect(role).toBeTruthy();

  await owner.client.from("organization_invites").insert({
    organization_id: orgId,
    role_id: role!.id,
    invited_by: owner.id,
  });
  const { data: inv } = await owner.client
    .from("organization_invites")
    .select("token")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  const { error } = await user.client.rpc("redeem_invite", {
    p_token: inv!.token,
  });
  expect(error).toBeNull();
}

async function notificationsFor(client: SupabaseClient, userId: string) {
  const { data } = await admin
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at");
  return data ?? [];
}

d("Notifications", () => {
  let owner: { id: string; client: SupabaseClient };
  let editorA: { id: string; client: SupabaseClient };
  let reviewer: { id: string; client: SupabaseClient };

  let orgId: string;
  let jobId: string;
  let submissionId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    owner = await makeUser("owner");
    editorA = await makeUser("editor-a");
    reviewer = await makeUser("reviewer");

    const { data: orgIdData, error } = await owner.client.rpc(
      "create_organization",
      { p_name: "Notif Org", p_slug: `notif-org-${suffix}` },
    );
    expect(error).toBeNull();
    orgId = orgIdData!;

    await inviteAndJoin(owner, orgId, "Editor", editorA);
    await inviteAndJoin(owner, orgId, "Admin", reviewer);

    const { data: job } = await owner.client
      .from("jobs")
      .insert({
        organization_id: orgId,
        title: "Notification cycle",
        category: "Promo / Ad",
        claim_mode: "direct",
        created_by: owner.id,
      })
      .select("id")
      .single();
    jobId = job!.id;
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("notifies the editor when a reviewer assigns the job", async () => {
    const { error } = await owner.client
      .from("jobs")
      .update({ status: "taken", assigned_to: editorA.id })
      .eq("id", jobId)
      .eq("status", "open");
    expect(error).toBeNull();

    const rows = await notificationsFor(editorA.client, editorA.id);
    const assigned = rows.find((n) => n.type === "job_assigned");
    expect(assigned).toBeTruthy();
    expect(assigned!.payload.job_id).toBe(jobId);
    expect(assigned!.payload.title).toBe("Notification cycle");
  });

  it("notifies the poster when a delivery lands", async () => {
    const { data: submissionIdData, error } = await editorA.client.rpc(
      "submit_drive_link",
      { p_job_id: jobId, p_url: DRIVE_LINK, p_note: null, p_verified: false },
    );
    expect(error).toBeNull();
    submissionId = submissionIdData!;

    const rows = await notificationsFor(owner.client, owner.id);
    const delivered = rows.find((n) => n.type === "submission_delivered");
    expect(delivered).toBeTruthy();
    expect(delivered!.payload.submission_id).toBe(submissionId);
    expect(delivered!.payload.version_number).toBe(1);

    // The delivering editor must NOT be notified about their own delivery.
    const editorRows = await notificationsFor(editorA.client, editorA.id);
    expect(
      editorRows.find((n) => n.type === "submission_delivered"),
    ).toBeUndefined();
  });

  it("notifies the editor when a revision is requested", async () => {
    const { error } = await reviewer.client.rpc("request_revision", {
      p_submission_id: submissionId,
    });
    expect(error).toBeNull();

    const rows = await notificationsFor(editorA.client, editorA.id);
    const revision = rows.find((n) => n.type === "revision_requested");
    expect(revision).toBeTruthy();
    expect(revision!.payload.submission_id).toBe(submissionId);
  });

  it("notifies the editor when the work is approved", async () => {
    // Redeliver so the submission is pending again, then approve.
    const { error: deliverErr } = await editorA.client.rpc("submit_drive_link", {
      p_job_id: jobId,
      p_url: DRIVE_LINK,
      p_note: null,
      p_verified: false,
    });
    expect(deliverErr).toBeNull();

    const { error } = await reviewer.client.rpc("approve_submission", {
      p_submission_id: submissionId,
    });
    expect(error).toBeNull();

    const rows = await notificationsFor(editorA.client, editorA.id);
    expect(rows.find((n) => n.type === "submission_approved")).toBeTruthy();
  });

  it("keeps notifications private and lets owners mark their own read", async () => {
    const rows = await notificationsFor(editorA.client, editorA.id);
    expect(rows.length).toBeGreaterThan(0);

    // Another user cannot read the editor's notifications.
    const { data: foreignView } = await owner.client
      .from("notifications")
      .select("id")
      .eq("user_id", editorA.id);
    expect(foreignView ?? []).toHaveLength(0);

    // The editor marks their own read.
    const { error } = await editorA.client
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("user_id", editorA.id)
      .is("read_at", null);
    expect(error).toBeNull();

    const after = await notificationsFor(editorA.client, editorA.id);
    expect(after.every((n) => n.read_at !== null)).toBe(true);
  });
});
