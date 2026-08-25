/**
 * Submissions & revision workflow tests — runs against the live project.
 * Requires .env.local with Supabase keys and migrations 0001–0005 applied.
 * Covers: delivery gates, versioning, revision rounds, approval closing the
 * job, and RLS visibility of submissions/versions/comments.
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
const PASSWORD = "sift-subs-test-123";
const DRIVE_LINK =
  "https://drive.google.com/file/d/11xN9tnL8RriFTPNeu05JvE6i3Dc_wMc8/view?usp=sharing";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-subs-${label}-${suffix}@test.example`;
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

async function deliver(
  client: SupabaseClient,
  jobId: string,
  url = DRIVE_LINK,
  note: string | null = null,
) {
  return client.rpc("submit_drive_link", {
    p_job_id: jobId,
    p_url: url,
    p_note: note,
    p_verified: false,
  });
}

d("Submissions & revision enforcement", () => {
  let owner: { id: string; client: SupabaseClient };
  let editorA: { id: string; client: SupabaseClient };
  let editorB: { id: string; client: SupabaseClient };
  let reviewer: { id: string; client: SupabaseClient };
  let plainMember: { id: string; client: SupabaseClient };
  let outsider: { id: string; client: SupabaseClient };

  let orgId: string;
  let jobId: string;
  let submissionId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    owner = await makeUser("owner");
    editorA = await makeUser("editor-a");
    editorB = await makeUser("editor-b");
    reviewer = await makeUser("reviewer");
    plainMember = await makeUser("member");
    outsider = await makeUser("outsider");

    const { data: orgIdData, error } = await owner.client.rpc(
      "create_organization",
      { p_name: "Subs Org", p_slug: `subs-org-${suffix}` },
    );
    expect(error).toBeNull();
    orgId = orgIdData!;

    await inviteAndJoin(owner, orgId, "Editor", editorA);
    await inviteAndJoin(owner, orgId, "Editor", editorB);
    await inviteAndJoin(owner, orgId, "Admin", reviewer);
    await inviteAndJoin(owner, orgId, "Member", plainMember);

    await outsider.client.rpc("create_organization", {
      p_name: "Outsider Org",
      p_slug: `subs-out-${suffix}`,
    });

    const { data: job } = await owner.client
      .from("jobs")
      .insert({
        organization_id: orgId,
        title: "Revision cycle short",
        category: "Short",
        claim_mode: "direct",
        pay_amount: "250",
        created_by: owner.id,
      })
      .select("id")
      .single();
    jobId = job!.id;

    const { error: claimErr } = await editorA.client.rpc("claim_job", {
      p_job_id: jobId,
    });
    expect(claimErr).toBeNull();
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("blocks direct inserts into submissions — delivery only via RPC", async () => {
    const { error } = await editorA.client.from("submissions").insert({
      job_id: jobId,
      organization_id: orgId,
      editor_id: editorA.id,
    });
    expect(error).not.toBeNull();
  });

  it("refuses delivery from anyone but the assigned editor", async () => {
    const { error } = await deliver(editorB.client, jobId);
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("assigned editor");
  });

  it("refuses links that are not Drive file links", async () => {
    const { error } = await deliver(
      editorA.client,
      jobId,
      "https://example.com/video.mp4",
    );
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("drive");
  });

  it("creates the submission and v1 on first delivery", async () => {
    const { data, error } = await deliver(
      editorA.client,
      jobId,
      DRIVE_LINK,
      "first cut",
    );
    expect(error).toBeNull();
    submissionId = data!;

    const { data: sub } = await admin
      .from("submissions")
      .select("status, revision_count, editor_id")
      .eq("id", submissionId)
      .single();
    expect(sub!.status).toBe("pending");
    expect(sub!.editor_id).toBe(editorA.id);

    const { data: versions } = await admin
      .from("submission_versions")
      .select("version_number, drive_link, note")
      .eq("submission_id", submissionId)
      .order("version_number");
    expect(versions).toHaveLength(1);
    expect(versions![0].version_number).toBe(1);
    expect(versions![0].note).toBe("first cut");
    expect(versions![0].drive_link).toBe(DRIVE_LINK);

    const { data: job } = await admin
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    expect(job!.status).toBe("in_review");
  });

  it("appends v2 when the editor delivers again while pending", async () => {
    const { data, error } = await deliver(editorA.client, jobId, DRIVE_LINK, "tightened pacing");
    expect(error).toBeNull();
    expect(data).toBe(submissionId); // one submission per job

    const { data: versions } = await admin
      .from("submission_versions")
      .select("version_number")
      .eq("submission_id", submissionId)
      .order("version_number");
    expect(versions!.map((v) => v.version_number)).toEqual([1, 2]);
  });

  it("hides submissions, versions and comments from non-participants", async () => {
    for (const spectator of [plainMember, outsider]) {
      const { data: subs } = await spectator.client
        .from("submissions")
        .select("id")
        .eq("id", submissionId);
      expect(subs ?? []).toHaveLength(0);

      const { data: vers } = await spectator.client
        .from("submission_versions")
        .select("id")
        .eq("submission_id", submissionId);
      expect(vers ?? []).toHaveLength(0);
    }

    const { data: seenByEditor } = await editorA.client
      .from("submissions")
      .select("id")
      .eq("id", submissionId);
    expect(seenByEditor ?? []).toHaveLength(1);

    const { data: seenByReviewer } = await reviewer.client
      .from("submissions")
      .select("id")
      .eq("id", submissionId);
    expect(seenByReviewer ?? []).toHaveLength(1);
  });

  it("gates revision requests behind review_submissions", async () => {
    const { error: editorErr } = await editorB.client.rpc("request_revision", {
      p_submission_id: submissionId,
    });
    expect(editorErr).not.toBeNull();
    expect(editorErr!.message.toLowerCase()).toContain("permission");
  });

  it("moves pending → revision_requested and bumps the counter", async () => {
    const { error } = await reviewer.client.rpc("request_revision", {
      p_submission_id: submissionId,
    });
    expect(error).toBeNull();

    const { data: sub } = await admin
      .from("submissions")
      .select("status, revision_count")
      .eq("id", submissionId)
      .single();
    expect(sub!.status).toBe("revision_requested");
    expect(sub!.revision_count).toBe(1);
  });

  it("refuses a second revision request on the same round", async () => {
    const { error } = await reviewer.client.rpc("request_revision", {
      p_submission_id: submissionId,
    });
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("fresh delivery");
  });

  it("returns the submission to pending when the editor redelivers", async () => {
    const { error } = await deliver(editorA.client, jobId, DRIVE_LINK, "v3 per notes");
    expect(error).toBeNull();

    const { data: sub } = await admin
      .from("submissions")
      .select("status, revision_count")
      .eq("id", submissionId)
      .single();
    expect(sub!.status).toBe("pending");
    expect(sub!.revision_count).toBe(1); // deliveries never bump the counter

    const { data: versions } = await admin
      .from("submission_versions")
      .select("version_number")
      .eq("submission_id", submissionId)
      .order("version_number");
    expect(versions!.map((v) => v.version_number)).toEqual([1, 2, 3]);
  });

  it("lets participants comment — pinned and general — and blocks outsiders", async () => {
    const { error: reviewerPinErr } = await reviewer.client
      .from("comments")
      .insert({
        version_id: (await admin.from("submission_versions").select("id").eq("submission_id", submissionId).order("version_number").limit(1).single()).data!.id,
        organization_id: orgId,
        author_id: reviewer.id,
        body: "Cut the intro by half",
        timestamp_seconds: 12.5,
      });
    expect(reviewerPinErr).toBeNull();

    const { data: v3 } = await admin
      .from("submission_versions")
      .select("id")
      .eq("submission_id", submissionId)
      .order("version_number", { ascending: false })
      .limit(1)
      .single();

    const { error: editorErr } = await editorA.client.from("comments").insert({
      version_id: v3!.id,
      organization_id: orgId,
      author_id: editorA.id,
      body: "Done, trimmed to 8s",
    });
    expect(editorErr).toBeNull();

    const { error: memberErr } = await plainMember.client
      .from("comments")
      .insert({
        version_id: v3!.id,
        organization_id: orgId,
        author_id: plainMember.id,
        body: "sneaky note",
      });
    expect(memberErr).not.toBeNull();
  });

  it("lets only authors or reviewers resolve comments", async () => {
    const { data: pinned } = await admin
      .from("comments")
      .select("id, author_id")
      .eq("organization_id", orgId)
      .eq("resolved", false)
      .order("created_at");
    const reviewerComment = pinned!.find((c) => c.author_id === reviewer.id)!;
    const editorComment = pinned!.find((c) => c.author_id === editorA.id)!;

    // RLS-blocked updates filter rows silently — prove the comment is unchanged.
    await editorB.client
      .from("comments")
      .update({ resolved: true })
      .eq("id", reviewerComment.id);
    const { data: untouched } = await admin
      .from("comments")
      .select("resolved")
      .eq("id", reviewerComment.id)
      .single();
    expect(untouched!.resolved).toBe(false);

    const { error: selfErr } = await editorA.client
      .from("comments")
      .update({ resolved: true })
      .eq("id", editorComment.id);
    expect(selfErr).toBeNull();

    const { error: reviewerErr } = await reviewer.client
      .from("comments")
      .update({ resolved: true })
      .eq("id", reviewerComment.id);
    expect(reviewerErr).toBeNull();
  });

  it("gates approval behind approve_submissions", async () => {
    const { error } = await editorB.client.rpc("approve_submission", {
      p_submission_id: submissionId,
    });
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("permission");
  });

  it("approves the submission and completes the job", async () => {
    const { error } = await reviewer.client.rpc("approve_submission", {
      p_submission_id: submissionId,
    });
    expect(error).toBeNull();

    const { data: sub } = await admin
      .from("submissions")
      .select("status")
      .eq("id", submissionId)
      .single();
    expect(sub!.status).toBe("approved");

    const { data: job } = await admin
      .from("jobs")
      .select("status")
      .eq("id", jobId)
      .single();
    expect(job!.status).toBe("completed");
  });

  it("refuses approval of an already-approved submission", async () => {
    const { error } = await reviewer.client.rpc("approve_submission", {
      p_submission_id: submissionId,
    });
    expect(error).not.toBeNull();
  });

  it("refuses delivery on a completed job", async () => {
    const { error } = await deliver(editorA.client, jobId);
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("not open for deliveries");
  });
});
