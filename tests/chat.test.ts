/**
 * Chat RLS & permission tests — runs against the live project.
 * Requires .env.local with Supabase keys and migrations 0001–0008 applied.
 * Covers: channel gating (moderate_chat), posting (send_chat), author-only
 * edits, author-or-moderator deletes, and cross-org isolation.
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
const PASSWORD = "sift-chat-test-123";

function userClient() {
  return createClient(URL!, ANON!);
}

async function makeUser(label: string) {
  const email = `sift-chat-${label}-${suffix}@test.example`;
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
  roleId: string,
  user: { id: string; client: SupabaseClient },
) {
  await owner.client.from("organization_invites").insert({
    organization_id: orgId,
    role_id: roleId,
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

d("Chat enforcement", () => {
  let owner: { id: string; client: SupabaseClient };
  let member: { id: string; client: SupabaseClient };
  let muted: { id: string; client: SupabaseClient };
  let mod: { id: string; client: SupabaseClient };
  let outsider: { id: string; client: SupabaseClient };

  let orgId: string;
  let generalId: string;
  let memberRoleId: string;
  let adminRoleId: string;
  let silentRoleId: string;
  let messageId: string;

  beforeAll(async () => {
    admin = createClient(URL!, SERVICE!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    owner = await makeUser("owner");
    member = await makeUser("member");
    muted = await makeUser("muted");
    mod = await makeUser("mod");
    outsider = await makeUser("outsider");

    const { data: orgIdData, error } = await owner.client.rpc(
      "create_organization",
      { p_name: "Chat Org", p_slug: `chat-org-${suffix}` },
    );
    expect(error).toBeNull();
    orgId = orgIdData!;

    const { data: roles } = await owner.client
      .from("roles")
      .select("id, name")
      .eq("organization_id", orgId);
    memberRoleId = roles!.find((r) => r.name === "Member")!.id;
    adminRoleId = roles!.find((r) => r.name === "Admin")!.id;

    // A custom role with zero permissions — the "muted" member.
    const { data: silentRole } = await owner.client
      .from("roles")
      .insert({ organization_id: orgId, name: "Silent", color: "#666666", position: 40 })
      .select("id")
      .single();
    silentRoleId = silentRole!.id;

    const { data: general } = await owner.client
      .from("chat_channels")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", "general")
      .single();
    generalId = general!.id; // seeded by create_organization

    await inviteAndJoin(owner, orgId, memberRoleId, member);
    await inviteAndJoin(owner, orgId, silentRoleId, muted);
    await inviteAndJoin(owner, orgId, adminRoleId, mod);

    await outsider.client.rpc("create_organization", {
      p_name: "Chat Outsiders",
      p_slug: `chat-out-${suffix}`,
    });
  });

  afterAll(async () => {
    for (const id of createdUsers) {
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("seeds a #general channel for new organizations", () => {
    expect(generalId).toBeTruthy();
  });

  it("hides channels and messages from non-members", async () => {
    const { data: chans } = await outsider.client
      .from("chat_channels")
      .select("id")
      .eq("organization_id", orgId);
    expect(chans ?? []).toHaveLength(0);

    const { data: msgs } = await outsider.client
      .from("chat_messages")
      .select("id")
      .eq("organization_id", orgId);
    expect(msgs ?? []).toHaveLength(0);
  });

  it("gates channel creation behind moderate_chat", async () => {
    const { error: memberErr } = await member.client.from("chat_channels").insert({
      organization_id: orgId,
      name: "member made this",
      slug: "member-made",
      created_by: member.id,
    });
    expect(memberErr).not.toBeNull();

    const { error: modErr } = await mod.client.from("chat_channels").insert({
      organization_id: orgId,
      name: "Edits Lounge",
      slug: "edits-lounge",
      created_by: mod.id,
    });
    expect(modErr).toBeNull();
  });

  it("enforces unique channel slugs per organization", async () => {
    const { error } = await mod.client.from("chat_channels").insert({
      organization_id: orgId,
      name: "Edits Lounge",
      slug: "edits-lounge",
      created_by: mod.id,
    });
    expect(error).not.toBeNull();
    expect(error!.code).toBe("23505");
  });

  it("gates posting behind send_chat — muted members read but cannot write", async () => {
    const { data: seen } = await muted.client
      .from("chat_channels")
      .select("id")
      .eq("organization_id", orgId);
    expect(seen ?? []).toHaveLength(2); // can read

    const { error } = await muted.client.from("chat_messages").insert({
      channel_id: generalId,
      organization_id: orgId,
      author_id: muted.id,
      body: "can anyone hear me",
    });
    expect(error).not.toBeNull();
  });

  it("lets send_chat holders post", async () => {
    const { data, error } = await member.client
      .from("chat_messages")
      .insert({
        channel_id: generalId,
        organization_id: orgId,
        author_id: member.id,
        body: "first message in here",
      })
      .select("id")
      .single();
    expect(error).toBeNull();
    messageId = data!.id;
  });

  it("lets authors edit their own messages only", async () => {
    const { error } = await member.client
      .from("chat_messages")
      .update({ body: "first message (fixed typo)", edited_at: new Date().toISOString() })
      .eq("id", messageId);
    expect(error).toBeNull();

    const { data: after } = await admin
      .from("chat_messages")
      .select("body, edited_at")
      .eq("id", messageId)
      .single();
    expect(after!.body).toContain("fixed typo");
    expect(after!.edited_at).not.toBeNull();

    // Moderators can delete but never rewrite someone else's words.
    await mod.client
      .from("chat_messages")
      .update({ body: "hijacked" })
      .eq("id", messageId);
    const { data: untouched } = await admin
      .from("chat_messages")
      .select("body")
      .eq("id", messageId)
      .single();
    expect(untouched!.body).toContain("fixed typo");
  });

  it("restricts deletes to the author or moderate_chat holders", async () => {
    // A second message from the member, deleted by the mod.
    const { data: second } = await member.client
      .from("chat_messages")
      .insert({
        channel_id: generalId,
        organization_id: orgId,
        author_id: member.id,
        body: "moderator, remove this one please",
      })
      .select("id")
      .single();

    const { error: modDelErr } = await mod.client
      .from("chat_messages")
      .delete()
      .eq("id", second!.id);
    expect(modDelErr).toBeNull();
    const { data: gone } = await admin
      .from("chat_messages")
      .select("id")
      .eq("id", second!.id);
    expect(gone ?? []).toHaveLength(0);

    // The muted member cannot delete the member's message — silent filter.
    await muted.client.from("chat_messages").delete().eq("id", messageId);
    const { data: survives } = await admin
      .from("chat_messages")
      .select("id")
      .eq("id", messageId);
    expect(survives ?? []).toHaveLength(1);

    // Authors can always delete their own.
    const { error: ownErr } = await member.client
      .from("chat_messages")
      .delete()
      .eq("id", messageId);
    expect(ownErr).toBeNull();
  });

  it("gates channel deletion behind moderate_chat", async () => {
    const { data: lounge } = await owner.client
      .from("chat_channels")
      .select("id")
      .eq("organization_id", orgId)
      .eq("slug", "edits-lounge")
      .single();

    await member.client.from("chat_channels").delete().eq("id", lounge!.id);
    const { data: survives } = await owner.client
      .from("chat_channels")
      .select("id")
      .eq("id", lounge!.id);
    expect(survives ?? []).toHaveLength(1);

    const { error } = await mod.client.from("chat_channels").delete().eq("id", lounge!.id);
    expect(error).toBeNull();
  });
});
