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

const email = `lat-diag-${suffix}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
const userId = created.user.id;

const user = createClient(URL, ANON);
await user.auth.signInWithPassword({ email, password: "diag-pass-123" });

const { data: orgId } = await user.rpc("create_organization", {
  p_name: "Latency Diag",
  p_slug: `lat-diag-${suffix}`,
});
const { data: channel } = await admin
  .from("chat_channels")
  .select("id")
  .eq("organization_id", orgId)
  .single();

// 1) Warm up + time the RPC itself.
const t0 = performance.now();
const { error: rpcErr } = await user.rpc("send_chat_message", {
  p_channel_id: channel.id,
  p_body: "warmup",
});
const t1 = performance.now();
console.log(`rpc warmup: ${(t1 - t0).toFixed(0)}ms ${rpcErr ? rpcErr.message : "ok"}`);

// 2) Time RPC + event delivery end to end.
let eventAt = null;
const sub = user
  .channel(`lat-diag-${suffix}`)
  .on(
    "postgres_changes",
    {
      event: "INSERT",
      schema: "public",
      table: "chat_messages",
      filter: `organization_id=eq.${orgId}`,
    },
    () => {
      eventAt = performance.now();
    },
  );
await new Promise((r) =>
  sub.subscribe((status) => {
    if (status === "SUBSCRIBED") r(null);
  }),
);

await new Promise((r) => setTimeout(r, 300));
const t2 = performance.now();
await user.rpc("send_chat_message", {
  p_channel_id: channel.id,
  p_body: "latency probe",
});
const t3 = performance.now();

await new Promise((resolve2) => {
  const check = setInterval(() => {
    if (eventAt !== null) {
      clearInterval(check);
      resolve2(null);
    }
  }, 20);
  setTimeout(() => {
    clearInterval(check);
    resolve2(null);
  }, 8000);
});

console.log(`rpc call: ${(t3 - t2).toFixed(0)}ms`);
console.log(
  eventAt !== null
    ? `event delivered: ${(eventAt - t3).toFixed(0)}ms after rpc returned (total ${(eventAt - t2).toFixed(0)}ms from send)`
    : "event: NEVER ARRIVED in 8s",
);

await admin.from("organizations").delete().eq("id", orgId);
await admin.auth.admin.deleteUser(userId);
process.exit(0);
