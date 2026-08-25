/**
 * Job board RLS & permission tests — runs against the live project.
 * Requires .env.local with Supabase keys and migrations 0001–0004 applied.
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
const PASSWORD = "sift-jobs-test-123";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-jobs-${label}-${suffix}@test.example`;
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

  // Fetch by token through the definer preview is anon-only; owner reads directly.
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

d("Job board enforcement", () => {
  let owner: { id: string; client: SupabaseClient };
  let editorA: { id: string; client: SupabaseClient };
  let editorB: { id: string; client: SupabaseClient };
  let plainMember: { id: string; client: SupabaseClient };

  let orgId: string;
  let directJobId: string;
  let appJobId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    owner = await makeUser("owner");
    editorA = await makeUser("editor-a");
    editorB = await makeUser("editor-b");
    plainMember = await makeUser("member");

    const slug = `jobs-org-${suffix}`;
    const { data: orgIdData, error } = await owner.client.rpc(
      "create_organization",
      { p_name: "Jobs Org", p_slug: slug },
    );
    expect(error).toBeNull();
    orgId = orgIdData!;

    await inviteAndJoin(owner, orgId, "Editor", editorA);
    await inviteAndJoin(owner, orgId, "Editor", editorB);
    await inviteAndJoin(owner, orgId, "Member", plainMember);

    const { data: directJob } = await owner.client
      .from("jobs")
      .insert({
        organization_id: orgId,
        title: "Direct claim promo",
        category: "Promo / Ad",
        claim_mode: "direct",
        pay_amount: "400",
        created_by: owner.id,
      })
      .select("id")
      .single();
    directJobId = directJob!.id;

    const { data: appJob } = await owner.client
      .from("jobs")
      .insert({
        organization_id: orgId,
        title: "Application music video",
        category: "Music Video",
        claim_mode: "application",
        created_by: owner.id,
      })
      .select("id")
      .single();
    appJobId = appJob!.id;
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("hides org A jobs from an outsider", async () => {
    const outsider = await makeUser("outsider");
    const { error: orgErr, data } = await outsider.client.rpc("create_organization", {
      p_name: "Other Org",
      p_slug: `other-${suffix}`,
    });
    expect(orgErr).toBeNull();
    expect(data).toBeTruthy();

    const { data: seen } = await outsider.client
      .from("jobs")
      .select("*")
      .eq("organization_id", orgId);
    expect(seen ?? []).toHaveLength(0);
  });

  it("blocks members without post_jobs from creating jobs", async () => {
    const { error } = await editorA.client.from("jobs").insert({
      organization_id: orgId,
      title: "Sneaky self-published job",
      category: "Other",
      claim_mode: "direct",
      created_by: editorA.id,
    });
    expect(error).not.toBeNull();
  });

  it("lets post_jobs holders create jobs (owner)", async () => {
    const { data, error } = await owner.client
      .from("jobs")
      .select("id")
      .eq("organization_id", orgId);
    expect(error).toBeNull();
    expect(data!.length).toBe(2);
  });

  it("makes direct claims atomic — first wins, second gets a clean refusal", async () => {
    const { error: firstErr } = await editorA.client.rpc("claim_job", {
      p_job_id: directJobId,
    });
    expect(firstErr).toBeNull();

    const { error: secondErr } = await editorB.client.rpc("claim_job", {
      p_job_id: directJobId,
    });
    expect(secondErr).not.toBeNull();
    expect(secondErr!.message.toLowerCase()).toContain("claimed");

    const { data: job } = await admin
      .from("jobs")
      .select("status, assigned_to")
      .eq("id", directJobId)
      .single();
    expect(job!.status).toBe("taken");
    expect(job!.assigned_to).toBe(editorA.id);
  });

  it("refuses direct claim on application-mode jobs", async () => {
    const { error } = await editorA.client.rpc("claim_job", {
      p_job_id: appJobId,
    });
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("application");
  });

  it("gates applications behind apply_to_jobs", async () => {
    const { data: jobOrg } = await admin
      .from("jobs")
      .select("organization_id")
      .eq("id", appJobId)
      .single();

    const { error: deniedErr } = await plainMember.client
      .from("job_applications")
      .insert({
        job_id: appJobId,
        organization_id: jobOrg!.organization_id,
        user_id: plainMember.id,
      });
    expect(deniedErr).not.toBeNull();

    const { error: okErr } = await editorA.client.from("job_applications").insert({
      job_id: appJobId,
      organization_id: jobOrg!.organization_id,
      user_id: editorA.id,
      note: "fast turnaround",
    });
    expect(okErr).toBeNull();

    const { error: dupErr } = await editorA.client.from("job_applications").insert({
      job_id: appJobId,
      organization_id: jobOrg!.organization_id,
      user_id: editorA.id,
    });
    expect(dupErr).not.toBeNull(); // unique(job_id,user_id)
  });

  it("lets reviewers assign an applicant and auto-settles the queue", async () => {
    await editorB.client.from("job_applications").insert({
      job_id: appJobId,
      organization_id: orgId,
      user_id: editorB.id,
    });

    const { error } = await owner.client
      .from("jobs")
      .update({ status: "taken", assigned_to: editorA.id })
      .eq("id", appJobId)
      .eq("status", "open");
    expect(error).toBeNull();

    const { data: apps } = await admin
      .from("job_applications")
      .select("user_id, status")
      .eq("job_id", appJobId);

    const statuses = new Map(apps!.map((a) => [a.user_id, a.status]));
    expect(statuses.get(editorA.id)).toBe("accepted");
    expect(statuses.get(editorB.id)).toBe("declined");

    // Double-assign attempt is a no-op (status guard).
    const { data: updated } = await owner.client
      .from("jobs")
      .update({ status: "taken", assigned_to: editorB.id })
      .eq("id", appJobId)
      .eq("status", "open");
    expect(updated ?? []).toHaveLength(0);
  });

  it("keeps application notes hidden from members who lack review rights", async () => {
    const { data } = await plainMember.client
      .from("job_applications")
      .select("*")
      .eq("job_id", appJobId);
    expect(data ?? []).toHaveLength(0); // plain member sees nothing

    const { data: ownView } = await editorB.client
      .from("job_applications")
      .select("note, status")
      .eq("job_id", appJobId)
      .eq("user_id", editorB.id);
    expect(ownView ?? []).toHaveLength(1); // but sees their own row
  });
});
