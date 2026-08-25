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

const email = `seed-diag-${suffix}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
const client = createClient(URL, ANON);
await client.auth.signInWithPassword({ email, password: "diag-pass-123" });

const { data: orgId, error: orgErr } = await client.rpc("create_organization", {
  p_name: "Seed Diag",
  p_slug: `seeddiag-${suffix}`,
});
console.log("org:", orgErr ? orgErr.message : orgId);

const { data: roles } = await admin
  .from("roles")
  .select("id, name, position")
  .eq("organization_id", orgId)
  .order("position");

for (const r of roles ?? []) {
  const { data: perms } = await admin
    .from("role_permissions")
    .select("permission")
    .eq("role_id", r.id);
  console.log(r.name, "→", perms?.map((p) => p.permission).sort().join(", "));
}

const editor = roles.find((r) => r.name === "Editor");
const { data: filtered, error: filterErr } = await admin
  .from("role_permissions")
  .select("id, permission")
  .eq("role_id", editor.id)
  .eq("permission", "send_chat");
console.log(
  "enum-filtered send_chat on Editor:",
  filterErr ? `ERROR ${filterErr.code}: ${filterErr.message}` : `${filtered?.length ?? 0} row(s)`,
);

await admin.from("organizations").delete().eq("id", orgId);
await admin.auth.admin.deleteUser(created.user.id);
console.log("cleanup done");
