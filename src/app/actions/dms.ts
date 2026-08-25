"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function editDmMessageAction(formData: FormData) {
  const supabase = await createClient();
  const messageId = String(formData.get("message_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return;

  await supabase
    .from("dm_messages")
    .update({ body, edited_at: new Date().toISOString() })
    .eq("id", messageId);

  revalidatePath(`/o/${slug}/chat`);
}

export async function deleteDmMessageAction(formData: FormData) {
  const supabase = await createClient();
  const messageId = String(formData.get("message_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  await supabase.from("dm_messages").delete().eq("id", messageId);

  revalidatePath(`/o/${slug}/chat`);
}
