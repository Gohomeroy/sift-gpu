import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state"); // user_id
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code || !state) {
    return NextResponse.redirect(
      new URL(`/profile?error=Instagram+OAuth+denied`, req.url),
    );
  }

  const supabase = await createClient();

  // Exchange code for short-lived access token.
  const tokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `client_id=${process.env.INSTAGRAM_CLIENT_ID}&` +
    `client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&` +
    `redirect_uri=${encodeURIComponent(`${process.env.NEXT_PUBLIC_SITE_URL}/api/oauth/instagram/callback`)}&` +
    `code=${code}`,
  );
  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return NextResponse.redirect(
      new URL(`/profile?error=Instagram+token+exchange+failed`, req.url),
    );
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return NextResponse.redirect(
      new URL(`/profile?error=No+Instagram+access+token`, req.url),
    );
  }

  // Exchange for long-lived token (60 days).
  const longTokenRes = await fetch(
    `https://graph.facebook.com/v19.0/oauth/access_token?` +
    `grant_type=fb_exchange_token&` +
    `client_id=${process.env.INSTAGRAM_CLIENT_ID}&` +
    `client_secret=${process.env.INSTAGRAM_CLIENT_SECRET}&` +
    `fb_exchange_token=${accessToken}`,
  );
  const longTokenData = await longTokenRes.json();
  const longLivedToken = longTokenData.access_token ?? accessToken;

  // Fetch Instagram user info via Pages.
  const pagesRes = await fetch(
    `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,instagram_business_account&access_token=${longLivedToken}`,
  );
  const pagesData = await pagesRes.json();
  const page = pagesData.data?.[0];
  const igAccount = page?.instagram_business_account;

  if (!igAccount) {
    return NextResponse.redirect(
      new URL(`/profile?error=No+Instagram+Business+account+linked+to+Facebook+page`, req.url),
    );
  }

  // Fetch IG profile.
  const profileRes = await fetch(
    `https://graph.facebook.com/v19.0/${igAccount.id}?fields=username,name&access_token=${longLivedToken}`,
  );
  const profileData = await profileRes.json();
  const handle = profileData.username ?? igAccount.id;
  const displayName = profileData.name ?? handle;

  // Upsert linked account.
  const { data: existing } = await supabase
    .from("linked_accounts")
    .select("id")
    .eq("user_id", state)
    .eq("platform", "instagram")
    .eq("handle", handle)
    .maybeSingle();

  if (existing) {
    await supabase
      .from("linked_accounts")
      .update({
        oauth_access_token: longLivedToken,
        verified_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await supabase.from("linked_accounts").insert({
      user_id: state,
      platform: "instagram",
      handle,
      verification_code: `IG_${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      verified_at: new Date().toISOString(),
      oauth_access_token: longLivedToken,
    });
  }

  return NextResponse.redirect(
    new URL("/profile?connected=instagram", req.url),
  );
}
