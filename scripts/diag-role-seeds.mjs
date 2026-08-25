import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: orgs } = await admin
  .from("organizations")
  .select("id, name, slug, created_at")
  .order("created_at", { ascending: false })
  .limit(6);

for (const org of orgs ?? []) {
  const { data: roles } = await admin
    .from("roles")
    .select("id, name, is_system, position")
    .eq("organization_id", org.id)
    .order("position");
  const editor = roles?.find((r) => r.name === "Editor");
  let perms = null;
  if (editor) {
    const { data: rp } = await admin
      .from("role_permissions")
      .select("permission")
      .eq("role_id", editor.id);
    perms = rp?.map((r) => r.permission).sort() ?? null;
  }
  console.log(
    JSON.stringify({
      slug: org.slug,
      created: org.created_at,
      editor_perms: perms,
      role_names: roles?.map((r) => r.name),
    }),
  );
}
