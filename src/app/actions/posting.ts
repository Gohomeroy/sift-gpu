"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

export async function createClipPostAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const clipId = String(formData.get("clip_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const caption = String(formData.get("caption") ?? "").trim() || null;
  const hashtagsRaw = String(formData.get("hashtags") ?? "").trim();
  const slug = String(formData.get("slug") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  if (!clipId || !accountId) {
    return { error: "Select a clip and a linked account.", success: null };
  }

  // Parse hashtags from comma/space separated string.
  const hashtags = hashtagsRaw
    ? hashtagsRaw.split(/[, ]+/).filter(Boolean).map((t) => (t.startsWith("#") ? t : `#${t}`))
    : [];

  const { data, error } = await supabase.rpc("create_clip_post", {
    p_clip_id: clipId,
    p_account_id: accountId,
    p_caption: caption,
    p_hashtags: JSON.stringify(hashtags),
  });

  if (error) return { error: error.message, success: null };

  revalidatePath(`/o/${slug}/clipper`);
  return { error: null, success: `POST:${data}` };
}

export async function cancelClipPostAction(formData: FormData) {
  const supabase = await createClient();
  const postId = String(formData.get("post_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase
    .from("clip_posts")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", postId);

  revalidatePath(`/o/${slug}/clipper`);
}

export async function retryClipPostAction(formData: FormData) {
  const supabase = await createClient();
  const postId = String(formData.get("post_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  // Reset to queued for retry.
  await supabase
    .from("clip_posts")
    .update({ status: "queued", error: null, updated_at: new Date().toISOString() })
    .eq("id", postId)
    .eq("status", "failed");

  revalidatePath(`/o/${slug}/clipper`);
}

export async function connectPlatformAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const platform = String(formData.get("platform") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  // Build the OAuth redirect URL.
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";
  const redirectUri = `${baseUrl}/api/oauth/${platform}/callback`;

  let authUrl: string;

  switch (platform) {
    case "tiktok":
      authUrl = `https://www.tiktok.com/v2/auth/authorize/?` +
        `client_key=${process.env.TIKTOK_CLIENT_KEY}&` +
        `response_type=code&` +
        `scope=user.info.basic,video.upload,video.publish&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `state=${user.id}`;
      break;

    case "youtube":
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
        `client_id=${process.env.GOOGLE_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `response_type=code&` +
        `scope=https://www.googleapis.com/auth/youtube.upload+https://www.googleapis.com/auth/youtube&` +
        `access_type=offline&` +
        `prompt=consent&` +
        `state=${user.id}`;
      break;

    case "instagram":
      authUrl = `https://www.facebook.com/v19.0/dialog/oauth?` +
        `client_id=${process.env.INSTAGRAM_CLIENT_ID}&` +
        `redirect_uri=${encodeURIComponent(redirectUri)}&` +
        `scope=instagram_basic,instagram_content_publish,pages_show_list&` +
        `state=${user.id}`;
      break;

    default:
      return { error: "Unsupported platform.", success: null };
  }

  return { error: null, success: `REDIRECT:${authUrl}` };
}
