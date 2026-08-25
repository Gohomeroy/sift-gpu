/**
 * Reviews & reputation tests — runs against the live project.
 * Requires .env.local with Supabase keys and migrations 0001–0015 applied.
 * Covers: approver-only reviews, self-review ban, approved-submission
 * requirement, one review per submission, rating bounds, upsert semantics,
 * and org visibility.
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
const PASSWORD = "sift-review-test-123";
const DRIVE_LINK =
  "https://drive.google.com/file/d/11xN9tnL8RriFTPNeu05JvE6i3Dc_wMc8/view?usp=sharing";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-rev-${label}-${suffix}@test.example`;
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

d("Reviews & reputation", () => {
  let owner: { id: string; client: SupabaseClient };
  let editorA: { id: string; client: SupabaseClient };
  let reviewer: { id: string; client: SupabaseClient };
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
    reviewer = await makeUser("reviewer");
    outsider = await makeUser("outsider");

    const { data: orgIdData, error } = await owner.client.rpc(
      "create_organization",
      { p_name: "Review Org", p_slug: `review-org-${suffix}` },
    );
    expect(error).toBeNull();
    orgId = orgIdData!;

    await inviteAndJoin(owner, orgId, "Editor", editorA);
    await inviteAndJoin(owner, orgId, "Admin", reviewer);

    await outsider.client.rpc("create_organization", {
      p_name: "Review Outsiders",
      p_slug: `review-out-${suffix}`,
    });

    const { data: job } = await owner.client
      .from("jobs")
      .insert({
        organization_id: orgId,
        title: "Reviewed promo",
        category: "Promo / Ad",
        claim_mode: "direct",
        created_by: owner.id,
      })
      .select("id")
      .single();
    jobId = job!.id;

    const { error: assignErr } = await owner.client
      .from("jobs")
      .update({ status: "taken", assigned_to: editorA.id })
      .eq("id", jobId)
      .eq("status", "open");
    expect(assignErr).toBeNull();

    const { data: subId, error: deliverErr } = await editorA.client.rpc(
      "submit_drive_link",
      { p_job_id: jobId, p_url: DRIVE_LINK, p_note: null, p_verified: false },
    );
    expect(deliverErr).toBeNull();
    submissionId = subId!;
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("refuses reviews before approval", async () => {
    const { error } = await reviewer.client.from("reviews").insert({
      submission_id: submissionId,
      organization_id: orgId,
      reviewer_id: reviewer.id,
      editor_id: editorA.id,
      rating: 5,
    });
    expect(error).not.toBeNull();
  });

  it("refuses the editor reviewing their own work", async () => {
    // Approve first so the approval precondition isn't what blocks it.
    const { error: approveErr } = await reviewer.client.rpc("approve_submission", {
      p_submission_id: submissionId,
    });
    expect(approveErr).toBeNull();

    const { error } = await editorA.client.from("reviews").insert({
      submission_id: submissionId,
      organization_id: orgId,
      reviewer_id: editorA.id,
      editor_id: editorA.id,
      rating: 5,
    });
    expect(error).not.toBeNull();
  });

  it("refuses members without approve_submissions", async () => {
    const { error } = await editorA.client.from("reviews").insert({
      submission_id: submissionId,
      organization_id: orgId,
      reviewer_id: editorA.id,
      editor_id: owner.id,
      rating: 4,
    });
    expect(error).not.toBeNull();
  });

  it("rejects out-of-range ratings", async () => {
    const { error } = await reviewer.client.from("reviews").insert({
      submission_id: submissionId,
      organization_id: orgId,
      reviewer_id: reviewer.id,
      editor_id: editorA.id,
      rating: 6,
    });
    expect(error).not.toBeNull();
  });

  it("lets the approver review the editor after approval", async () => {
    const { data, error } = await reviewer.client
      .from("reviews")
      .insert({
        submission_id: submissionId,
        organization_id: orgId,
        reviewer_id: reviewer.id,
        editor_id: editorA.id,
        rating: 5,
        note: "crisp cut, delivered early",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    expect(data!.id).toBeTruthy();
  });

  it("enforces one review per submission via reviewer upsert semantics", async () => {
    // A second INSERT (different reviewer is impossible — one approver here,
    // and the unique constraint is on the submission) must fail.
    const { error } = await reviewer.client.from("reviews").insert({
      submission_id: submissionId,
      organization_id: orgId,
      reviewer_id: reviewer.id,
      editor_id: editorA.id,
      rating: 3,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");

    // But the reviewer may refine their own review.
    const { error: updateErr } = await reviewer.client
      .from("reviews")
      .update({ rating: 4, note: "still great — one nitpick" })
      .eq("submission_id", submissionId)
      .eq("reviewer_id", reviewer.id);
    expect(updateErr).toBeNull();

    const { data: after } = await admin
      .from("reviews")
      .select("rating, note")
      .eq("submission_id", submissionId)
      .single();
    expect(after!.rating).toBe(4);
  });

  it("keeps reviews visible to the org and hidden from outsiders", async () => {
    const { data: memberView } = await owner.client
      .from("reviews")
      .select("id, rating")
      .eq("organization_id", orgId);
    expect(memberView ?? []).toHaveLength(1);

    const { data: foreignView } = await outsider.client
      .from("reviews")
      .select("id")
      .eq("organization_id", orgId);
    expect(foreignView ?? []).toHaveLength(0);
  });
});
