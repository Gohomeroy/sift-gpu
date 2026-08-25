import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `invite-diag-${Date.now().toString(36)}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
const userId = created.user.id;

const anon = createClient(URL, ANON);
await anon.auth.signInWithPassword({ email, password: "diag-pass-123" });

const slug = `invdiag-${Date.now().toString(36)}`;
const { data: orgId, error: orgErr } = await anon.rpc("create_organization", {
  p_name: "Invite Diag",
  p_slug: slug,
});
console.log("org:", orgErr ? `ERROR ${orgErr.message}` : orgId);

// Grab the Editor role like the app's invite form does.
const { data: roles, error: rolesErr } = await anon
  .from("roles")
  .select("id, name")
  .eq("organization_id", orgId);
console.log("roles read:", rolesErr ? `ERROR ${rolesErr.message}` : `${roles.length} roles`);
const editor = roles?.find((r) => r.name === "Editor");

// Insert an invite EXACTLY like createInviteAction does.
const { data: inv, error: invErr } = await anon
  .from("organization_invites")
  .insert({
    organization_id: orgId,
    role_id: editor.id,
    email: null,
    expires_at: new Date(Date.now() + 7 * 86400000).toISOString(),
    max_uses: null,
    invited_by: userId,
  })
  .select("token")
  .single();

console.log(
  "invite insert:",
  invErr ? `CODE ${invErr.code} | ${invErr.message} | hint=${invErr.hint} details=${invErr.details}` : `ok token=${inv.token.slice(0, 10)}…`,
);

// Also probe each policy condition separately via direct queries.
const { data: perm } = await anon.rpc("has_org_permission", {
  p_org: orgId,
  p_perm: "manage_roles",
});
console.log("has_org_permission(manage_roles):", perm);

await admin.from("organizations").delete().eq("id", orgId);
await admin.auth.admin.deleteUser(userId);
console.log("cleanup done");
