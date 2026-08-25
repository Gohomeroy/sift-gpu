import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: invites } = await admin
  .from("organization_invites")
  .select("organization_id, role_id, invited_by, email, token, max_uses, uses, expires_at, created_at")
  .order("created_at", { ascending: false })
  .limit(5);

console.log("=== recent invites:");
for (const i of invites ?? []) {
  console.log(JSON.stringify({
    org: i.organization_id.slice(0, 8),
    email: i.email,
    token_full: i.token,
    max_uses: i.max_uses,
    uses: i.uses,
    expires_at: i.expires_at,
  }));
}

// Test the exact RPC the invite page uses, for the newest token
if (invites?.length) {
  const anon = createClient(URL, ANON); // not signed in — like the invite page pre-login
  const { data: preview, error } = await anon.rpc("invite_preview", {
    p_token: invites[0].token,
  });
  console.log("\n=== invite_preview (newest token):");
  console.log(error ? `RPC ERROR ${error.code}: ${error.message}` : JSON.stringify(preview));
}
