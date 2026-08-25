import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// All real orgs + owners
const { data: orgs } = await admin
  .from("organizations")
  .select("id, name, slug, owner_id, status, plan")
  .order("created_at");
console.log("=== ORGS:");
for (const o of orgs ?? []) {
  console.log(` ${o.slug} | owner=${o.owner_id} | status=${o.status} | plan=${o.plan}`);
}

// All users (via profiles)
const { data: profiles } = await admin
  .from("profiles")
  .select("id, display_name");
console.log("\n=== PROFILES:");
for (const p of profiles ?? []) console.log(` ${p.id} | ${p.display_name}`);

// Memberships + roles per org
const { data: members } = await admin
  .from("organization_members")
  .select("id, organization_id, user_id, status");
console.log("\n=== MEMBERS:");
for (const m of members ?? []) {
  const { data: mr } = await admin
    .from("member_roles")
    .select("role_id")
    .eq("organization_member_id", m.id);
  const { data: roles } = await admin
    .from("roles")
    .select("id, name")
    .in("id", (mr ?? []).map((r) => r.role_id));
  console.log(
    ` org=${m.organization_id.slice(0, 8)}… user=${m.user_id.slice(0, 8)}… status=${m.status} roles=[${(roles ?? []).map((r) => r.name).join(",")}]`,
  );
}

// Existing invites
const { data: invites } = await admin
  .from("organization_invites")
  .select("organization_id, invited_by, role_id, email, token");
console.log("\n=== INVITES:", (invites ?? []).length);
for (const i of invites ?? []) {
  console.log(` org=${i.organization_id.slice(0, 8)}… by=${i.invited_by?.slice(0, 8)}… token=${i.token.slice(0, 10)}…`);
}
