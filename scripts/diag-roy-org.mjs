import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ROY_ORG_SLUG = "traxn-studios";

// 1. Inspect Roy's org row fully
const { data: org } = await admin
  .from("organizations")
  .select("id, name, slug, owner_id, status, plan, settings")
  .eq("slug", ROY_ORG_SLUG)
  .single();
console.log("== org:", JSON.stringify(org, null, 2));

// 2. Probe user: fresh account, added as ADMIN member (has manage_roles) of Roy's org
const email = `probe-${Date.now().toString(36)}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "probe-pass-123",
  email_confirm: true,
});
const probeId = created.user.id;

await admin.from("organization_members").insert({
  organization_id: org.id,
  user_id: probeId,
});

// Give probe a custom role carrying ONLY manage_roles
const { data: probeRole } = await admin
  .from("roles")
  .insert({
    organization_id: org.id,
    name: `probe-${Date.now().toString(36)}`,
    color: "#0570de",
  })
  .select("id")
  .single();
await admin.from("role_permissions").insert({
  role_id: probeRole.id,
  permission: "manage_roles",
});
const { data: probeMember } = await admin
  .from("organization_members")
  .select("id")
  .eq("organization_id", org.id)
  .eq("user_id", probeId)
  .single();
await admin
  .from("member_roles")
  .insert({
    organization_member_id: probeMember.id,
    role_id: probeRole.id,
    organization_id: org.id,
  });

// 3. Sign in as probe and try the invite insert against Roy's org
const anon = createClient(URL, ANON);
await anon.auth.signInWithPassword({ email, password: "probe-pass-123" });

const perm = await anon.rpc("has_org_permission", {
  p_org: org.id,
  p_perm: "manage_roles",
});
console.log("== probe has_org_permission(manage_roles):", perm.data, perm.error?.message ?? "");

const { data: inv, error: invErr } = await anon
  .from("organization_invites")
  .insert({
    organization_id: org.id,
    role_id: probeRole.id,
    invited_by: probeId,
  })
  .select("token")
  .single();
console.log(
  "== invite insert:",
  invErr ? `${invErr.code} | ${invErr.message}` : `ok ${inv.token.slice(0, 10)}…`,
);

// 4. Compare: what does Roy's ownership actually look like?
const { data: royProfile } = await admin
  .from("profiles")
  .select("id, display_name")
  .eq("display_name", "Roy")
  .maybeSingle();
console.log("== Roy profile:", royProfile);
console.log("== org.owner_id == Roy profile id:", org.owner_id === royProfile?.id);

// cleanup probe traces (keep org untouched)
if (inv) await admin.from("organization_invites").delete().eq("token", inv.token);
await admin.from("member_roles").delete().eq("organization_member_id", probeMember.id);
await admin.from("role_permissions").delete().eq("role_id", probeRole.id);
await admin.from("roles").delete().eq("id", probeRole.id);
await admin.from("organization_members").delete().eq("id", probeMember.id);
await admin.auth.admin.deleteUser(probeId);
console.log("== probe cleaned");
