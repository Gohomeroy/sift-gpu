import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// 1. Is migration 0004 applied at all?
console.log("== 1. jobs table reachable (service):");
{
  const { data, error } = await admin.from("jobs").select("id, title, organization_id, created_at").limit(5);
  console.log(error ? `ERROR: ${error.message}` : `ok, ${data.length} recent job(s)`);
  if (!error && data.length) console.log(JSON.stringify(data, null, 2));
}

// 2. Full app-path reproduction: user -> org -> insert job -> detail-page query.
const email = `diag-${Date.now().toString(36)}@test.example`;
const { data: created } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
const userId = (created.user ?? {}).id ?? null;

const anon = createClient(URL, ANON);
await anon.auth.signInWithPassword({ email, password: "diag-pass-123" });

const slug = `diag-${Date.now().toString(36)}`;
const { data: orgId, error: orgErr } = await anon.rpc("create_organization", {
  p_name: "Diag Org",
  p_slug: slug,
});
console.log("\n== 2. create_organization:", orgErr ? `ERROR ${orgErr.message}` : `ok ${orgId}`);

// 3. Plan-gate RPC present?
const { data: gate, error: gateErr } = await anon.rpc("org_within_job_limits", {
  p_org: orgId,
});
console.log("== 3. org_within_job_limits:", gateErr ? `ERROR ${gateErr.message}` : `returns ${gate}`);

// 4. claim_job RPC present?
{
  const { error } = await anon.rpc("claim_job", {
    p_job_id: "00000000-0000-0000-0000-000000000000",
  });
  console.log(
    "== 4. claim_job:",
    error ? `${error.code ?? ""} ${error.message}` : "unexpected success",
  );
}

// 5. Insert a job exactly like createJobAction does.
const { data: job, error: jobErr } = await anon
  .from("jobs")
  .insert({
    organization_id: orgId,
    title: "Diag test promo",
    description: "",
    category: "Promo / Ad",
    pay_amount: 400,
    pay_currency: "USD",
    pay_note: null,
    deadline: null,
    required_skills: [],
    claim_mode: "application",
    created_by: userId,
    attachments: [],
  })
  .select("id")
  .single();
console.log("== 5. insert job:", jobErr ? `ERROR ${jobErr.message}` : `ok ${job && job.id}`);

// 6. Run the EXACT detail-page query with the member session.
if (job) {
  const { data: row, error: readErr } = await anon
    .from("jobs")
    .select("*")
    .eq("id", job.id)
    .eq("organization_id", orgId)
    .maybeSingle();
  console.log(
    "== 6. detail-page query:",
    readErr ? `ERROR ${readErr.code} ${readErr.message}` : row ? "row FOUND" : "ZERO ROWS (this causes the 404)",
  );
}

// cleanup
if (orgId) await admin.from("organizations").delete().eq("id", orgId);
await admin.auth.admin.deleteUser(userId);
console.log("\ncleanup done");

