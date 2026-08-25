import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: invites } = await admin
  .from("organization_invites")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(5);

for (const inv of invites ?? []) {
  const orgShort = inv.organization_id.slice(0, 8);
  const { data: org } = await admin
    .from("organizations")
    .select("id, name, slug, status")
    .eq("id", inv.organization_id)
    .maybeSingle();
  const { data: role } = await admin
    .from("roles")
    .select("id, name, organization_id")
    .eq("id", inv.role_id)
    .maybeSingle();

  console.log(JSON.stringify({
    token: inv.token.slice(0, 10),
    org: orgShort,
    org_found: org ? { slug: org.slug, status: org.status } : null,
    role_id: inv.role_id,
    role_found: role
      ? { name: role.name, role_org: role.organization_id.slice(0, 8) }
      : null,
    role_org_matches: role ? role.organization_id === inv.organization_id : false,
  }));
}
