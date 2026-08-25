/**
 * RLS & permission-matrix enforcement tests.
 *
 * These run against a REAL Supabase project (the only way to prove policies).
 * They create throwaway users/orgs, assert the deny matrix — especially
 * cross-tenant reads — and clean up after themselves.
 *
 * Requires .env.local with:
 *   NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY,
 *   SUPABASE_SERVICE_ROLE_KEY
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const ready = Boolean(URL && ANON && SERVICE);

const d = describe.skipIf(!ready);

let admin: SupabaseClient;
const createdUsers: string[] = [];
const suffix = Date.now().toString(36);

const PASSWORD = "sift-test-pass-123";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-${label}-${suffix}@test.example`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { display_name: `${label} ${suffix}` },
  });
  expect(error).toBeNull();
  const user = data?.user;
  if (!user) throw new Error("createUser returned no user");
  createdUsers.push(user.id);

  const client = userClient();
  const { error: signInError } = await client.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  expect(signInError).toBeNull();
  return { id: user.id, client };
}

d("RLS & permission enforcement", () => {
  let ownerA: { id: string; client: SupabaseClient };
  let editorA: { id: string; client: SupabaseClient };
  let outsider: { id: string; client: SupabaseClient };

  let orgAId: string;
  let orgBId: string;
  let editorRoleId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    ownerA = await makeUser("owner");
    editorA = await makeUser("editor");
    outsider = await makeUser("outsider");

    // Org A by ownerA, Org B by outsider — two tenants in one database.
    const slugA = `org-a-${suffix}`;
    const { data: aId, error: aErr } = await ownerA.client.rpc(
      "create_organization",
      { p_name: "Test Org A", p_slug: slugA },
    );
    expect(aErr).toBeNull();
    orgAId = aId!;

    const { data: bId, error: bErr } = await outsider.client.rpc(
      "create_organization",
      { p_name: "Test Org B", p_slug: `org-b-${suffix}` },
    );
    expect(bErr).toBeNull();
    orgBId = bId!;

    // Invite editorA into Org A with the Editor role.
    const { data: roles } = await ownerA.client
      .from("roles")
      .select("id, name")
      .eq("organization_id", orgAId);
    editorRoleId = roles!.find((r) => r.name === "Editor")!.id;

    const { error: invErr } = await ownerA.client
      .from("organization_invites")
      .insert({
        organization_id: orgAId,
        role_id: editorRoleId,
        invited_by: ownerA.id,
      })
      .select("token")
      .single();
    expect(invErr).toBeNull();

    const { data: invites } = await ownerA.client
      .from("organization_invites")
      .select("token")
      .eq("organization_id", orgAId);
    const token = invites![0]!.token;

    const { data: slugRedeemed, error: redeemErr } = await editorA.client.rpc(
      "redeem_invite",
      { p_token: token },
    );
    expect(redeemErr).toBeNull();
    expect(slugRedeemed).toBe(slugA);
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("seeds four system roles with the expected matrix shape", async () => {
    const { data: roles } = await ownerA.client
      .from("roles")
      .select("id, name, is_system")
      .eq("organization_id", orgAId)
      .order("position");

    expect(roles!.map((r) => r.name)).toEqual([
      "Owner",
      "Admin",
      "Editor",
      "Member",
    ]);
    expect(roles!.find((r) => r.name === "Owner")!.is_system).toBe(true);
    expect(roles!.find((r) => r.name === "Editor")!.is_system).toBe(false);
  });

  it("blocks cross-org reads on every tenant table", async () => {
    // editorA belongs to Org A only — Org B rows must be invisible.
    const tables = [
      ["organizations", "id"],
      ["organization_members", "organization_id"],
      ["roles", "organization_id"],
      ["member_roles", "organization_id"],
    ] as const;

    for (const [table, column] of tables) {
      const { data } = await editorA.client
        .from(table)
        .select("*")
        .eq(column as never, orgBId);
      expect(data ?? [], `cross-org read leaked via ${table}`).toHaveLength(0);
    }

    // And the reverse direction.
    const { data: bSideSeesA } = await outsider.client
      .from("organization_members")
      .select("*")
      .eq("organization_id", orgAId);
    expect(bSideSeesA ?? []).toHaveLength(0);
  });

  it("hides audit_log from members without access_admin_panel", async () => {
    const { data } = await editorA.client
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgAId);
    expect(data ?? []).toHaveLength(0);

    const { data: ownerView } = await ownerA.client
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgAId);
    expect(ownerView!.length).toBeGreaterThan(0);
  });

  it("denies invite creation and reading to members without manage_roles", async () => {
    const { data: visible } = await editorA.client
      .from("organization_invites")
      .select("*")
      .eq("organization_id", orgAId);
    expect(visible ?? []).toHaveLength(0);

    const { error } = await editorA.client
      .from("organization_invites")
      .insert({ organization_id: orgAId, role_id: editorRoleId });
    expect(error).not.toBeNull();
  });

  it("denies permission edits to members without manage_roles", async () => {
    const { error } = await editorA.client
      .from("role_permissions")
      .insert({ role_id: editorRoleId, permission: "kick_users" });
    expect(error).not.toBeNull();

    const { error: delErr } = await editorA.client
      .from("role_permissions")
      .delete()
      .eq("role_id", editorRoleId)
      .eq("permission", "send_chat");
    // RLS-blocked deletes filter rows silently (no error) — prove survival.
    expect(delErr).toBeNull();
    const { data: stillThere, error: stillErr } = await ownerA.client
      .from("role_permissions")
      .select("permission")
      .eq("role_id", editorRoleId)
      .eq("permission", "send_chat")
      .single();
    expect(stillErr).toBeNull();
    expect(stillThere?.permission).toBe("send_chat");
  });

  it("lets owners grant kick but still protects the owner row", async () => {
    // Owner adds kick_users to the Editor role through the normal API path.
    const { error: grantErr } = await ownerA.client
      .from("role_permissions")
      .insert({ role_id: editorRoleId, permission: "kick_users" });
    expect(grantErr).toBeNull();

    const { data: ownerRow } = await ownerA.client
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgAId)
      .eq("user_id", ownerA.id)
      .single();

    // Editor now has kick_users — but the owner's membership is untouchable.
    const { error } = await editorA.client
      .from("organization_members")
      .delete()
      .eq("id", ownerRow!.id);

    expect(error).toBeNull(); // delete succeeds silently…
    const { data: stillThere } = await ownerA.client
      .from("organization_members")
      .select("id")
      .eq("id", ownerRow!.id);
    expect(stillThere!).toHaveLength(1); // …because RLS filtered the row out.

    // Cleanup: take kick back off the Editor role.
    await ownerA.client
      .from("role_permissions")
      .delete()
      .eq("role_id", editorRoleId)
      .eq("permission", "kick_users");
  });

  it("bans block re-invite redemption; unban restores it", async () => {
    const { data: memberRow } = await ownerA.client
      .from("organization_members")
      .select("id")
      .eq("organization_id", orgAId)
      .eq("user_id", editorA.id)
      .single();

    const { error: banErr } = await ownerA.client
      .from("organization_members")
      .update({ status: "banned" })
      .eq("id", memberRow!.id);
    expect(banErr).toBeNull();

    // Fresh invite while banned.
    const { data: inv, error: invErr } = await ownerA.client
      .from("organization_invites")
      .insert({
        organization_id: orgAId,
        role_id: editorRoleId,
        invited_by: ownerA.id,
      })
      .select("token")
      .single();
    expect(invErr).toBeNull();

    const { error } = await editorA.client.rpc("redeem_invite", {
      p_token: inv!.token,
    });
    expect(error).not.toBeNull();
    expect(error!.message.toLowerCase()).toContain("ban");

    // Unban restores the original membership row to active — no re-redeem
    // needed (and redeeming while a member correctly refuses).
    const { error: unbanErr } = await ownerA.client
      .from("organization_members")
      .update({ status: "active" })
      .eq("id", memberRow!.id);
    expect(unbanErr).toBeNull();

    const { data: restored } = await ownerA.client
      .from("organization_members")
      .select("status")
      .eq("id", memberRow!.id)
      .single();
    expect(restored!.status).toBe("active");
  });

  it("rejects reserved slugs atomically", async () => {
    const { error } = await ownerA.client.rpc("create_organization", {
      p_name: "Sneaky",
      p_slug: "admin",
    });
    expect(error).not.toBeNull();

    // No partial rows from the failed attempt.
    const { data: sneakyOrgs } = await ownerA.client
      .from("organizations")
      .select("id")
      .eq("name", "Sneaky");
    expect(sneakyOrgs ?? []).toHaveLength(0);
  });

  it("keeps platform admins outside private org content", async () => {
    // Promote outsider to platform staff directly (service-role operation).
    await admin.from("platform_admins").insert({ user_id: outsider.id });

    // Platform admin CAN see org metadata for management purposes…
    const { data: orgsSeen } = await outsider.client
      .from("organizations")
      .select("id, name, plan, status");
    expect(orgsSeen?.some((o) => o.id === orgAId)).toBe(true);

    // …but NEVER roster or audit content.
    const { data: roster } = await outsider.client
      .from("organization_members")
      .select("*")
      .eq("organization_id", orgAId);
    expect(roster ?? []).toHaveLength(0);

    const { data: audit } = await outsider.client
      .from("audit_log")
      .select("*")
      .eq("organization_id", orgAId);
    expect(audit ?? []).toHaveLength(0);
  });

  it("prevents owners from leaving their own organization", async () => {
    const { error } = await ownerA.client.rpc("leave_organization", {
      p_org: orgAId,
    });
    expect(error).not.toBeNull();
    expect(error!.message).toContain("Owners cannot leave");
  });

  it("logs role assignments into the audit trail", async () => {
    const { data: entries } = await ownerA.client
      .from("audit_log")
      .select("action")
      .eq("organization_id", orgAId);

    const actions = new Set(entries!.map((e) => e.action));
    expect(actions.has("organization_invites.insert")).toBe(true);
    expect(actions.has("organization_members.update")).toBe(true); // ban/unban cycle
    expect(actions.has("role_permissions.delete")).toBe(true); // kick_users cleanup
  });
});

if (!ready) {
  describe("setup", () => {
    it.skip(
      "SUPABASE env vars missing — add them to .env.local to run RLS tests",
      () => {},
    );
  });
}
