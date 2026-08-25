import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `comment-diag-${Date.now().toString(36)}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
const userId = created.user.id;

const { data: org } = await admin
  .from("organizations")
  .select("id")
  .eq("slug", "traxn-studios")
  .maybeSingle();

await admin.from("organization_members").insert({
  organization_id: org.id,
  user_id: userId,
  status: "active",
});

// Give the test member a role that carries review_submissions (like the app does).
const { data: member } = await admin
  .from("organization_members")
  .select("id")
  .eq("organization_id", org.id)
  .eq("user_id", userId)
  .maybeSingle();
const { data: roles } = await admin
  .from("roles")
  .select("id, role_permissions!inner(permission)")
  .eq("organization_id", org.id)
  .eq("role_permissions.permission", "review_submissions")
  .limit(1);
if (!roles?.length) throw new Error("no role with review_submissions found");
await admin.from("member_roles").insert({
  organization_member_id: member.id,
  role_id: roles[0].id,
  organization_id: org.id,
});
console.log(`test member assigned role with review_submissions`);

const { data: version } = await admin
  .from("submission_versions")
  .select("id, organization_id")
  .limit(1)
  .maybeSingle();

const anon = createClient(URL, ANON);
const { error: signInErr } = await anon.auth.signInWithPassword({
  email,
  password: "diag-pass-123",
});
if (signInErr) throw signInErr;

// Exactly what the fixed addCommentAction inserts.
const { error: insertErr } = await anon.from("comments").insert({
  version_id: version.id,
  organization_id: version.organization_id,
  author_id: userId,
  body: "diag comment — safe to delete",
  timestamp_seconds: 4.2,
});
console.log("comment insert:", insertErr ? `FAILED ${insertErr.code}: ${insertErr.message}` : "OK (RLS passed)");

// Non-member must be blocked.
const outsider = `comment-diag-out-${Date.now().toString(36)}@test.example`;
await admin.auth.admin.createUser({
  email: outsider,
  password: "diag-pass-123",
  email_confirm: true,
});
const outClient = createClient(URL, ANON);
await outClient.auth.signInWithPassword({ email: outsider, password: "diag-pass-123" });
const { data: outUser } = await outClient.auth.getUser();
const { error: deniedErr } = await outClient.from("comments").insert({
  version_id: version.id,
  organization_id: version.organization_id,
  author_id: outUser.user.id,
  body: "should not land",
});
console.log("non-member insert:", deniedErr ? `BLOCKED (${deniedErr.code})` : "LEAKED — RLS HOLE");

// Cleanup.
const { data: mine } = await admin
  .from("comments")
  .select("id")
  .eq("author_id", userId);
if (mine?.length) await admin.from("comments").delete().in("id", mine.map((c) => c.id));
await admin.from("organization_members").delete().eq("organization_id", org.id).eq("user_id", userId);await admin.auth.admin.deleteUser(userId);
await admin.auth.admin.deleteUser(outUser.user.id);
console.log("cleanup done");
