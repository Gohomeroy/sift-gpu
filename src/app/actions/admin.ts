"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function setOrgStatusAction(formData: FormData) {
  const supabase = await createClient();
  const orgId = String(formData.get("org_id") ?? "");
  const status = String(formData.get("status") ?? "");

  if (!orgId || !["active", "suspended"].includes(status)) return;

  await supabase.rpc("admin_set_organization_status", {
    p_org: orgId,
    p_status: status,
  });

  revalidatePath("/admin");
}

export async function setOrgPlanAction(formData: FormData) {
  const supabase = await createClient();
  const orgId = String(formData.get("org_id") ?? "");
  const plan = String(formData.get("plan") ?? "");

  if (!orgId || !["free", "pro", "studio"].includes(plan)) return;

  await supabase.rpc("admin_set_organization_plan", {
    p_org: orgId,
    p_plan: plan,
  });

  revalidatePath("/admin");
}
