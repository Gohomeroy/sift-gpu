import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `repro-${Date.now().toString(36)}@test.example`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password: "repro-pass-123",
  email_confirm: true,
});
if (createErr || !created?.user) {
  console.error("could not create repro user:", createErr?.message);
  process.exit(1);
}

const anon = createClient(URL, ANON);
const { error: signInErr } = await anon.auth.signInWithPassword({
  email,
  password: "repro-pass-123",
});
if (signInErr) {
  console.error("sign-in failed:", signInErr.message);
  process.exit(1);
}

const slug = `repro-${Date.now().toString(36)}`;
const { data: orgId, error: orgErr } = await anon.rpc("create_organization", {
  p_name: "Repro Org",
  p_slug: slug,
});

console.log("rpc error:", orgErr);
console.log("org id:", orgId);

// Inspect whatever state landed (function should be atomic on failure).
const { data: orgs } = await admin
  .from("organizations")
  .select("id, name, slug")
  .eq("slug", slug);

if (orgs?.length) {
  const org = orgs[0];
  const { count: roleCount } = await admin
    .from("roles")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", org.id);
  const { count: permCount } = await admin
    .from("role_permissions")
    .select(
      "role_id",
      { count: "exact", head: true },
    );
  console.log(
    `org created OK - seeded roles: ${roleCount}, total permission rows in project: ${permCount}`,
  );

  // Clean up the test tenant.
  await admin.from("organizations").delete().eq("id", org.id);
  console.log("cleanup: test org deleted");
} else {
  console.log("partial org rows: [] (atomic rollback confirmed)");
}

if (created.user) {
  await admin.auth.admin.deleteUser(created.user.id);
  console.log("cleanup: repro user deleted");
}
