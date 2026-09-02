import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state"); // user_id
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL(`/profile?error=Google+OAuth+denied`, req.url),
    );
  }

  const supabase = await createClient();

  // Exchange code for tokens.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${process.env.NEXT_PUBLIC_SITE_URL}/api/oauth/youtube/callback`,
      grant_type: "authorization_code",
    }),
  });

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return NextResponse.redirect(
      new URL(`/profile?error=Google+token+exchange+failed`, req.url),
    );
  }

  const accessToken = tokenData.access_token;
  const refreshToken = tokenData.refresh_token;

  if (!accessToken) {
    return NextResponse.redirect(
      new URL(`/profile?error=No+Google+access+token`, req.url),
    );
  }

  // Fetch YouTube channel info.
  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const channelData = await channelRes.json();
  const channel = channelData.items?.[0];
  const handle = channel?.snippet?.customUrl?.replace(/^@/, "") ?? channel?.id ?? "youtube_channel";
  const displayName = channel?.snippet?.title ?? handle;

  // Calculate token expiry.
  const expiresAt = new Date();
  expiresAt.setSeconds(expiresAt.getSeconds() + (tokenData.expires_in ?? 3600));

  // Upsert linked account.
  const { data: existing } = await supabase
    .from("linked_accounts")
    .select("id")
    .eq("user_id", state)
    .eq("platform", "youtube")
    .eq("handle", handle)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("linked_accounts")
      .update({
        oauth_access_token: accessToken,
        oauth_refresh_token: refreshToken,
        oauth_expires_at: expiresAt.toISOString(),
        verified_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("linked_accounts").insert({
      user_id: state,
      platform: "youtube",
      handle,
      verification_code: `YT_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      verified_at: new Date().toISOString(),
      oauth_access_token: accessToken,
      oauth_refresh_token: refreshToken,
      oauth_expires_at: expiresAt.toISOString(),
    });
  }

  return NextResponse.redirect(
    new URL("/profile?connected=youtube", req.url),
  );
}
