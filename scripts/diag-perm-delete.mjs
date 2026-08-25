import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const suffix = Date.now().toString(36);

async function makeUser(label) {
  const email = `perm2-diag-${label}-${suffix}@test.example`;
  const { data } = await admin.auth.admin.createUser({
    email,
    password: "diag-pass-123",
    email_confirm: true,
  });
  const client = createClient(URL, ANON);
  await client.auth.signInWithPassword({ email, password: "diag-pass-123" });
  return { id: data.user.id, client };
}

const owner = await makeUser("owner");
const editor = await makeUser("editor");
const outsiderOwner = await makeUser("outsider");

const { data: orgA } = await owner.client.rpc("create_organization", {
  p_name: "Perm Diag A2",
  p_slug: `permdiag2-a-${suffix}`,
});
const { data: orgB } = await outsiderOwner.client.rpc("create_organization", {
  p_name: "Perm Diag B2",
  p_slug: `permdiag2-b-${suffix}`,
});

const { data: editorRoleA } = await owner.client
  .from("roles")
  .select("id")
  .eq("organization_id", orgA)
  .eq("name", "Editor")
  .single();
const { data: inv } = await owner.client
  .from("organization_invites")
  .insert({ organization_id: orgA, role_id: editorRoleA.id, invited_by: owner.id })
  .select("token")
  .single();
await editor.client.rpc("redeem_invite", { p_token: inv.token });

async function count(roleId, permission) {
  const { data, error } = await admin
    .from("role_permissions")
    .select("permission")
    .eq("role_id", roleId)
    .eq("permission", permission);
  if (error) throw new Error(`count failed: ${error.message}`);
  return data.length;
}

console.log("same-org send_chat before:", await count(editorRoleA.id, "send_chat"));
const { error: sameErr } = await editor.client
  .from("role_permissions")
  .delete()
  .eq("role_id", editorRoleA.id)
  .eq("permission", "send_chat");
console.log(
  "same-org delete:",
  sameErr ? `denied (${sameErr.code})` : "no error (silent filter)",
  "| rows after:",
  await count(editorRoleA.id, "send_chat"),
);

const { data: adminRoleB } = await outsiderOwner.client
  .from("roles")
  .select("id")
  .eq("organization_id", orgB)
  .eq("name", "Admin")
  .single();
console.log("cross-org manage_roles before:", await count(adminRoleB.id, "manage_roles"));
const { error: crossErr } = await editor.client
  .from("role_permissions")
  .delete()
  .eq("role_id", adminRoleB.id)
  .eq("permission", "manage_roles");
console.log(
  "cross-org delete:",
  crossErr ? `denied (${crossErr.code})` : "no error (silent filter)",
  "| rows after:",
  await count(adminRoleB.id, "manage_roles"),
);

await admin.from("organizations").delete().in("id", [orgA, orgB]);
for (const u of [owner, editor, outsiderOwner]) {
  await admin.auth.admin.deleteUser(u.id);
}
console.log("cleanup done");
