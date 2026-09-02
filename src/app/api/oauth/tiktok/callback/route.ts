import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state"); // user_id
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL(`/profile?error=OAuth+denied`, req.url),
    );
  }

  const supabase = await createClient();

  // Exchange code for tokens.
  const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY!,
      client_secret: process.env.TIKTOK_CLIENT_SECRET!,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/oauth/tiktok/callback`,
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return NextResponse.redirect(
      new URL(`/profile?error=TikTok+token+exchange+failed`, req.url),
    );
  }

  const accessToken = tokenData.data?.access_token;
  const openId = tokenData.data?.open_id;

  if (!accessToken || !openId) {
    return NextResponse.redirect(
      new URL(`/profile?error=No+TikTok+access+token`, req.url),
    );
  }

  // Fetch TikTok user info.
  const userRes = await fetch(
    `https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,unique_id`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const userData = await userRes.json();
  const handle = userData.data?.user?.unique_id ?? "tiktok_user";
  const displayName = userData.data?.user?.display_name ?? handle;

  // Upsert linked account.
  const { data: existing } = await supabase
    .from("linked_accounts")
    .select("id")
    .eq("user_id", state)
    .eq("platform", "tiktok")
    .eq("handle", handle)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("linked_accounts")
      .update({
        oauth_access_token: accessToken,
        verified_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("linked_accounts").insert({
      user_id: state,
      platform: "tiktok",
      handle,
      verification_code: `TIKTOK_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      verified_at: new Date().toISOString(),
      oauth_access_token: accessToken,
    });
  }

  return NextResponse.redirect(
    new URL("/profile?connected=tiktok", req.url),
  );
}
