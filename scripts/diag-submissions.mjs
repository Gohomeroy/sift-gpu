import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { error: t } = await admin.from("submissions").select("id").limit(1);
console.log("submissions table:", t ? `MISSING (${t.code}: ${t.message})` : "exists");

const { error: f } = await admin.rpc("submit_drive_link", {
  p_job_id: "00000000-0000-0000-0000-000000000000",
  p_url: "x",
});
console.log("submit_drive_link rpc:", f ? `${f.code}: ${f.message}` : "exists");
