import { config } from "dotenv";
config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const { data: versions } = await admin
  .from("submission_versions")
  .select("id, version_number, drive_file_id, drive_link, link_verified_at, created_at")
  .order("created_at", { ascending: false })
  .limit(3);

console.log("=== recent versions:");
for (const v of versions ?? []) {
  console.log(JSON.stringify(v));
}

const fileId = versions?.[0]?.drive_file_id;
if (!fileId) {
  console.log("no file id to test");
  process.exit(0);
}

console.log(`\n=== probing Drive for file ${fileId}\n`);

// Step 1: exactly what resolveStreamUrl does.
const base = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
const first = await fetch(base, {
  redirect: "manual",
  signal: AbortSignal.timeout(10_000),
  headers: { Range: "bytes=0-0" },
});
console.log("step1 status:", first.status);
console.log("step1 content-type:", first.headers.get("content-type"));
console.log("step1 location:", first.headers.get("location"));
console.log("step1 content-range:", first.headers.get("content-range"));
console.log("step1 set-cookie present:", first.headers.has("set-cookie"));

if (first.status >= 300 && first.status < 400 && first.headers.get("location")) {
  const loc = first.headers.get("location");
  const second = await fetch(loc, {
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: { Range: "bytes=0-0" },
  });
  console.log("\nstep2 (followed location) status:", second.status);
  console.log("step2 content-type:", second.headers.get("content-type"));
  console.log("step2 content-range:", second.headers.get("content-range"));
  console.log("step2 location:", second.headers.get("location"));
  const buf = await second.arrayBuffer();
  console.log("step2 body bytes:", buf.byteLength);
  console.log("step2 body head:", JSON.stringify(new TextDecoder().decode(buf.slice(0, 200))));
} else {
  const ct = first.headers.get("content-type") ?? "";
  if (ct.includes("text/html")) {
    const html = await first.text();
    console.log("\nstep1 is HTML interstitial, length:", html.length);
    console.log("step1 form inputs:");
    for (const m of html.matchAll(/<input[^>]+name="([^"]+)"[^>]*>/g)) console.log("  ", m[0]);
    console.log("step1 body head:", JSON.stringify(html.slice(0, 300)));
  } else {
    const buf = await first.arrayBuffer();
    console.log("\nstep1 body bytes:", buf.byteLength);
    console.log("step1 body head:", JSON.stringify(new TextDecoder().decode(buf.slice(0, 100))));
  }
}

// Step 3: what the route ultimately hands the browser — base&confirm=t fallback.
const fallback = `${base}&confirm=t`;
const third = await fetch(fallback, {
  redirect: "follow",
  signal: AbortSignal.timeout(10_000),
  headers: { Range: "bytes=0-1023" },
});
console.log("\n=== fallback (base&confirm=t) status:", third.status);
console.log("fallback content-type:", third.headers.get("content-type"));
console.log("fallback content-range:", third.headers.get("content-range"));
const fbuf = await third.arrayBuffer();
console.log("fallback body bytes:", fbuf.byteLength);
console.log("fallback body head:", JSON.stringify(new TextDecoder().decode(fbuf.slice(0, 150))));
