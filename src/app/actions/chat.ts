"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { ActionState } from "@/lib/action-state";

function chatPaths(slug: string) {
  return [`/o/${slug}`, `/o/${slug}/chat`];
}

function slugify(raw: string) {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function createChannelAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const slug = String(formData.get("slug") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const topic = String(formData.get("topic") ?? "").trim() || null;

  if (!name) return { error: "Give the channel a name.", success: null };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const channelSlug = slugify(name);
  if (!channelSlug) {
    return { error: "That name needs at least one letter or number.", success: null };
  }

  const { error } = await supabase.from("chat_channels").insert({
    organization_id: formData.get("organization_id"),
    name,
    slug: channelSlug,
    topic,
    created_by: user.id,
  });

  if (error) {
    return {
      error: error.code === "23505" ? "That channel already exists." : error.message,
      success: null,
    };
  }

  chatPaths(slug).forEach((p) => revalidatePath(p));
  redirect(`/o/${slug}/chat?c=${channelSlug}`);
}

export async function renameChannelAction(formData: FormData) {
  const supabase = await createClient();
  const channelId = String(formData.get("channel_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const name = String(formData.get("name") ?? "").trim();

  if (!name) return;

  await supabase
    .from("chat_channels")
    .update({ name })
    .eq("id", channelId);

  chatPaths(slug).forEach((p) => revalidatePath(p));
}

export async function deleteChannelAction(formData: FormData) {
  const supabase = await createClient();
  const channelId = String(formData.get("channel_id") ?? "");
  const channelSlug = String(formData.get("channel_slug") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase.from("chat_channels").delete().eq("id", channelId);

  chatPaths(slug).forEach((p) => revalidatePath(p));

  // If the deleted channel was open, land on the default one.
  if (channelSlug) redirect(`/o/${slug}/chat`);
}

export async function editMessageAction(formData: FormData) {
  const supabase = await createClient();
  const messageId = String(formData.get("message_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return;

  await supabase
    .from("chat_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId);

  chatPaths(slug).forEach((p) => revalidatePath(p));
}

export async function deleteMessageAction(formData: FormData) {
  const supabase = await createClient();
  const messageId = String(formData.get("message_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase.from("chat_messages").delete().eq("id", messageId);

  chatPaths(slug).forEach((p) => revalidatePath(p));
}
