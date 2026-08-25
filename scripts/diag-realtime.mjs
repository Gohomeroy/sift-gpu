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

const email = `rt-diag-${suffix}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
const userId = created.user.id;

const user = createClient(URL, ANON);
await user.auth.signInWithPassword({ email, password: "diag-pass-123" });

const { data: orgId, error: orgErr } = await user.rpc("create_organization", {
  p_name: "RT Diag",
  p_slug: `rt-diag-${suffix}`,
});
if (orgErr) throw orgErr;

const { data: channel } = await admin
  .from("chat_channels")
  .select("id")
  .eq("organization_id", orgId)
  .single();

let received = null;
const sub = user
  .channel(`rt-diag-${suffix}`, {
    config: { broadcast: { self: false } },
  })
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "chat_messages",
      filter: `organization_id=eq.${orgId}`,
    },
    (payload) => {
      received = payload;
    },
  );

const status = await new Promise((resolve) => sub.subscribe((s) => resolve(s)));
console.log("subscription status:", status);

await new Promise((r) => setTimeout(r, 500));

await admin.from("chat_messages").insert({
  channel_id: channel.id,
  organization_id: orgId,
  author_id: userId,
  body: "realtime probe",
});

const outcome = await new Promise((resolve) => {
  const t = setTimeout(() => resolve("TIMEOUT — no event after 8s"), 8000);
  const check = setInterval(() => {
    if (received) {
      clearTimeout(t);
      clearInterval(check);
      resolve("EVENT RECEIVED");
    }
  }, 100);
});
console.log("result:", outcome);

await admin.from("organizations").delete().eq("id", orgId);
await admin.auth.admin.deleteUser(userId);
process.exit(0);
