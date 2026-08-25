import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const REF = URL.replace("https://", "").split(".")[0];
const COOKIE_KEY = `sb-${REF}-auth-token`;
const CHUNK_SIZE = 3180;

const admin = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `stream-diag-${Date.now().toString(36)}@test.example`;
const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password: "diag-pass-123",
  email_confirm: true,
});
if (createErr) throw createErr;
const userId = created.user.id;

const { data: org } = await admin
  .from("organizations")
  .select("id, slug")
  .eq("slug", "traxn-studios")
  .maybeSingle();
if (!org) throw new Error("org traxn-studios not found");

const { error: memberErr } = await admin.from("organization_members").insert({
  organization_id: org.id,
  user_id: userId,
  status: "active",
});
if (memberErr) throw memberErr;

// Password grant → the session JSON the browser would hold in its cookie.
const res = await fetch(`${URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "diag-pass-123" }),
});
const session = await res.json();
if (!session.access_token) throw new Error(`sign-in failed: ${JSON.stringify(session)}`);

// Encode exactly like @supabase/ssr: "base64-" + base64url(JSON), chunked.
const json = JSON.stringify(session);
const b64 = Buffer.from(json, "utf8").toString("base64url");
const encoded = "base64-" + b64;
const cookiePairs = [];
for (let i = 0, n = 0; i < encoded.length; i += CHUNK_SIZE, n++) {
  cookiePairs.push(`${COOKIE_KEY}.${n}=${encoded.slice(i, i + CHUNK_SIZE)}`);
}
const cookieHeader = cookiePairs.join("; ");
console.log(`cookie: ${cookiePairs.length} chunk(s), ${cookieHeader.length} chars total`);

const fileId = "11xN9tnL8RriFTPNeu05JvE6i3Dc_wMc8";
const route = `http://localhost:3000/api/drive-stream/${fileId}?org=${org.id}`;

// 1) No cookie → expect 401.
const noAuth = await fetch(route, { redirect: "manual" });
console.log("\nno-cookie status:", noAuth.status, await noAuth.text());

// 2) With session cookie + Range, like Chrome's media element.
const media = await fetch(route, {
  redirect: "manual",
  headers: { Cookie: cookieHeader, Range: "bytes=0-1023" },
});
console.log("\nwith-cookie status:", media.status);
console.log("content-type:", media.headers.get("content-type"));
console.log("content-range:", media.headers.get("content-range"));
console.log("content-disposition:", media.headers.get("content-disposition"));
console.log("accept-ranges:", media.headers.get("accept-ranges"));
const mbuf = await media.arrayBuffer();
console.log("body bytes:", mbuf.byteLength);
console.log("looks like mp4:", new TextDecoder().decode(mbuf.slice(0, 32)).includes("ftyp"));

// 3) Open-ended range like Chrome's initial probe.
const open = await fetch(route, {
  headers: { Cookie: cookieHeader, Range: "bytes=0-" },
});
console.log("\nopen-range status:", open.status);
console.log("content-type:", open.headers.get("content-type"));
console.log("content-range:", open.headers.get("content-range"));
await open.body?.cancel();

// Cleanup.
await admin.from("organization_members").delete().eq("organization_id", org.id).eq("user_id", userId);
await admin.auth.admin.deleteUser(userId);
console.log("\ncleanup done");
