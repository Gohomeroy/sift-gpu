import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: ch } = await admin
  .from("chat_channels")
  .select("id")
  .limit(1)
  .maybeSingle();

const { data, error } = await admin
  .from("chat_messages")
  .select("*, profiles(display_name, avatar_url)")
  .eq("channel_id", ch.id)
  .order("created_at", { ascending: false })
  .limit(100);

console.log("embed query:", error ? `ERROR ${error.code}: ${error.message}` : `${data.length} rows`);
