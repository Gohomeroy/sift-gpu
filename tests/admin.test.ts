/**
 * Platform admin RPC tests — runs against the live project.
 * Requires .env.local with Supabase keys and migrations 0001–0009 applied.
 * Covers: staff-only guards, suspension/plan changes, audit trail with the
 * acting staff user, and the content boundary (admins never see inside orgs).
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
const PASSWORD = "sift-admin-test-123";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-admin-${label}-${suffix}@test.example`;
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

d("Platform admin enforcement", () => {
  let owner: { id: string; client: SupabaseClient };
  let staff: { id: string; client: SupabaseClient };
  let orgId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    owner = await makeUser("owner");
    staff = await makeUser("staff");

    const { data: orgIdData, error } = await owner.client.rpc(
      "create_organization",
      { p_name: "Admin Org", p_slug: `admin-org-${suffix}` },
    );
    expect(error).toBeNull();
    orgId = orgIdData!;
  });

  afterAll(async () => {
    await admin.from("platform_admins").delete().eq("user_id", staff.id);
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("refuses the admin RPCs to non-staff users", async () => {
    const { error: statusErr } = await owner.client.rpc(
      "admin_set_organization_status",
      { p_org: orgId, p_status: "suspended" },
    );
    expect(statusErr).not.toBeNull();
    expect(statusErr!.message).toContain("Platform staff only.");

    const { error: planErr } = await owner.client.rpc(
      "admin_set_organization_plan",
      { p_org: orgId, p_plan: "pro" },
    );
    expect(planErr).not.toBeNull();
    expect(planErr!.message).toContain("Platform staff only.");
  });

  it("validates status and plan values", async () => {
    await admin.from("platform_admins").insert({ user_id: staff.id });

    const { error: badStatus } = await staff.client.rpc(
      "admin_set_organization_status",
      { p_org: orgId, p_status: "deleted" },
    );
    expect(badStatus).not.toBeNull();

    const { error: badPlan } = await staff.client.rpc(
      "admin_set_organization_plan",
      { p_org: orgId, p_plan: "enterprise" },
    );
    expect(badPlan).not.toBeNull();
  });

  it("lets staff suspend, and suspension cuts the owner's powers", async () => {
    const { error } = await staff.client.rpc("admin_set_organization_status", {
      p_org: orgId,
      p_status: "suspended",
    });
    expect(error).toBeNull();

    const { data: org } = await admin
      .from("organizations")
      .select("status")
      .eq("id", orgId)
      .single();
    expect(org!.status).toBe("suspended");

    // The row stays visible (the owner is still a member — that's how the
    // suspended banner renders), but the implicit owner bypass is gone:
    // manage_roles actions like invite creation are now refused.
    const { data: anyRole } = await admin
      .from("roles")
      .select("id")
      .eq("organization_id", orgId)
      .limit(1)
      .single();
    const { error: inviteErr } = await owner.client
      .from("organization_invites")
      .insert({
        organization_id: orgId,
        role_id: anyRole!.id,
        invited_by: owner.id,
      });
    expect(inviteErr).not.toBeNull();
  });

  it("writes the suspension into the org's audit log with the staff actor", async () => {
    const { data: entries } = await admin
      .from("audit_log")
      .select("action, actor_id, details")
      .eq("organization_id", orgId)
      .eq("action", "organizations.update")
      .order("created_at", { ascending: false })
      .limit(1);

    const entry = entries?.[0];
    expect(entry).toBeTruthy();
    expect(entry!.actor_id).toBe(staff.id);
    expect((entry!.details as { row?: { status?: string } }).row?.status).toBe(
      "suspended",
    );
  });

  it("lets staff reactivate and change plans", async () => {
    const { error: reactivateErr } = await staff.client.rpc(
      "admin_set_organization_status",
      { p_org: orgId, p_status: "active" },
    );
    expect(reactivateErr).toBeNull();

    const { error: planErr } = await staff.client.rpc(
      "admin_set_organization_plan",
      { p_org: orgId, p_plan: "pro" },
    );
    expect(planErr).toBeNull();

    const { data: org } = await admin
      .from("organizations")
      .select("status, plan")
      .eq("id", orgId)
      .single();
    expect(org!.status).toBe("active");
    expect(org!.plan).toBe("pro");
  });

  it("keeps staff outside org-private content even while operating it", async () => {
    const { data: roster } = await staff.client
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgId);
    expect(roster ?? []).toHaveLength(0);

    const { data: audit } = await staff.client
      .from("audit_log")
      .select("id")
      .eq("organization_id", orgId);
    expect(audit ?? []).toHaveLength(0);
  });
});
