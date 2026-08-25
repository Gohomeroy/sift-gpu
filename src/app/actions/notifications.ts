"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function markAllNotificationsReadAction(formData: FormData) {
  const supabase = await createClient();
  const orgId = String(formData.get("organization_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("organization_id", orgId)
    .is("read_at", null);

  revalidatePath(`/o/${slug}`, "layout");
}
