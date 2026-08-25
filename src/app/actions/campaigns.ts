"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { verifyAccountInBio, fetchViewCount, type Platform } from "@/lib/platforms";
import type { ActionState } from "@/lib/action-state";

function campaignsPaths(slug: string, campaignId?: string) {
  return campaignId
    ? [`/o/${slug}/campaigns`, `/o/${slug}/campaigns/${campaignId}`]
    : [`/o/${slug}/campaigns`];
}

export async function createCampaignAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const slug = String(formData.get("slug") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const brief = String(formData.get("brief") ?? "").trim();
  const rewardText = String(formData.get("reward_text") ?? "").trim() || null;
  const bannerPath = String(formData.get("banner_path") ?? "") || null;
  const rate = Number(formData.get("rate_per_1k_views") ?? 0);
  const cap = Number(formData.get("max_payout_per_entry") ?? 0);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  if (title.length < 3 || brief.length < 10) {
    return { error: "Give the campaign a title (3+) and a brief (10+ characters).", success: null };
  }

  const { data, error } = await supabase
    .from("campaigns")
    .insert({
      organization_id: formData.get("organization_id"),
      title,
      brief,
      reward_text: rewardText,
      banner_path: bannerPath,
      rate_per_1k_views: rate > 0 ? rate : null,
      max_payout_per_entry: cap > 0 ? cap : null,
      created_by: user.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message, success: null };

  campaignsPaths(slug).forEach((p) => revalidatePath(p));
  return { error: null, success: `CAMPAIGN:${data.id}` };
}

export async function toggleCampaignStatusAction(formData: FormData) {
  const supabase = await createClient();
  const campaignId = String(formData.get("campaign_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const slug = String(formData.get("slug") ?? "");

  if (!["open", "closed"].includes(status)) return;

  await supabase.from("campaigns").update({ status }).eq("id", campaignId);

  campaignsPaths(slug, campaignId).forEach((p) => revalidatePath(p));
}

// ----------------------------------------------------------------------------
// Linked accounts — verify ownership via a code scanned from the account bio.
// ----------------------------------------------------------------------------

export async function linkAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const platform = String(formData.get("platform") ?? "other") as Platform;
  const handle = String(formData.get("handle") ?? "").trim().replace(/^@/, "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  if (!handle) return { error: "Enter your account handle.", success: null };

  const { data: existing } = await supabase
    .from("linked_accounts")
    .select("id, verification_code, user_id")
    .eq("platform", platform)
    .eq("handle", handle)
    .maybeSingle();

  if (existing && existing.user_id !== user.id) {
    return { error: "That account is already linked to another clipper.", success: null };
  }

  if (existing) {
    return {
      error: null,
      success: `ACCOUNT:${existing.id}:${existing.verification_code}`,
    };
  }

  const { data, error } = await supabase
    .from("linked_accounts")
    .insert({ user_id: user.id, platform, handle })
    .select("id, verification_code")
    .single();

  if (error) return { error: error.message, success: null };

  revalidatePath("/profile");
  return { error: null, success: `ACCOUNT:${data.id}:${data.verification_code}` };
}

export async function verifyAccountAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const accountId = String(formData.get("account_id") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  const { data: account } = await supabase
    .from("linked_accounts")
    .select("*")
    .eq("id", accountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account) return { error: "Account not found.", success: null };

  const result = await verifyAccountInBio(
    account.platform as Platform,
    account.handle,
    account.verification_code,
  );
  if (!result.ok) return { error: result.reason, success: null };

  const { error } = await supabase
    .from("linked_accounts")
    .update({ verified_at: new Date().toISOString() })
    .eq("id", accountId);
  if (error) return { error: error.message, success: null };

  revalidatePath("/profile");
  return { error: null, success: "Account verified." };
}

export async function removeLinkedAccountAction(formData: FormData) {
  const supabase = await createClient();
  const accountId = String(formData.get("account_id") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await supabase
    .from("linked_accounts")
    .delete()
    .eq("id", accountId)
    .eq("user_id", user.id);

  revalidatePath("/profile");
}

// ----------------------------------------------------------------------------
// Entries — must come from one of the submitter's VERIFIED linked accounts.
// ----------------------------------------------------------------------------

export async function submitEntryAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const supabase = await createClient();
  const slug = String(formData.get("slug") ?? "");
  const campaignId = String(formData.get("campaign_id") ?? "");
  const platform = String(formData.get("platform") ?? "other");
  const url = String(formData.get("url") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim() || null;
  const linkedAccountId = String(formData.get("linked_account_id") ?? "");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Not signed in.", success: null };

  if (!url.startsWith("http")) {
    return { error: "Paste the full link to your clip.", success: null };
  }

  // The campaign is the source of truth for the org — never trust the client.
  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, organization_id, status")
    .eq("id", campaignId)
    .maybeSingle();
  if (!campaign || campaign.status !== "open") {
    return { error: "This campaign isn't open for entries.", success: null };
  }

  // Views are tracked by the platform — entries never self-report them.
  const { data: account } = await supabase
    .from("linked_accounts")
    .select("id, platform, verified_at, handle")
    .eq("id", linkedAccountId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!account || !account.verified_at) {
    return {
      error: "Pick a VERIFIED linked account — verify yours from your profile.",
      success: null,
    };
  }
  if (account.platform !== platform) {
    return {
      error: `That clip must be posted on the linked ${account.handle} ${account.platform} account.`,
      success: null,
    };
  }

  const { error } = await supabase.from("campaign_entries").insert({
    campaign_id: campaign.id,
    organization_id: campaign.organization_id,
    submitted_by: user.id,
    platform,
    url,
    note,
    linked_account_id: account.id,
    views: 0,
    views_updated_at: new Date().toISOString(),
  });

  if (error) return { error: error.message, success: null };

  campaignsPaths(slug, campaign.id).forEach((p) => revalidatePath(p));
  return { error: null, success: "Entry submitted — views are tracked from here." };
}

export async function setEntryStatusAction(formData: FormData) {
  const supabase = await createClient();
  const entryId = String(formData.get("entry_id") ?? "");
  const status = String(formData.get("status") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const campaignId = String(formData.get("campaign_id") ?? "");

  if (!["approved", "rejected", "pending"].includes(status)) return;

  await supabase.from("campaign_entries").update({ status }).eq("id", entryId);

  campaignsPaths(slug, campaignId).forEach((p) => revalidatePath(p));
}

export async function deleteEntryAction(formData: FormData) {
  const supabase = await createClient();
  const entryId = String(formData.get("entry_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const campaignId = String(formData.get("campaign_id") ?? "");

  await supabase.from("campaign_entries").delete().eq("id", entryId);

  campaignsPaths(slug, campaignId).forEach((p) => revalidatePath(p));
}

export async function refreshEntryViewsAction(formData: FormData) {
  const supabase = await createClient();
  const entryId = String(formData.get("entry_id") ?? "");
  const slug = String(formData.get("slug") ?? "");
  const campaignId = String(formData.get("campaign_id") ?? "");

  const { data: entry } = await supabase
    .from("campaign_entries")
    .select("platform, url")
    .eq("id", entryId)
    .maybeSingle();
  if (!entry) return;

  const count = await fetchViewCount(entry.platform as Platform, entry.url);
  if (count === null) return;

  // Atomic snapshot + update + payout math, member-gated in SQL.
  await supabase.rpc("record_entry_views", {
    p_entry_id: entryId,
    p_views: count,
  });

  campaignsPaths(slug, campaignId).forEach((p) => revalidatePath(p));
}

export async function refreshAllCampaignViewsAction(formData: FormData) {
  const supabase = await createClient();
  const campaignId = String(formData.get("campaign_id") ?? "");
  const slug = String(formData.get("slug") ?? "");

  const { data: entries } = await supabase
    .from("campaign_entries")
    .select("id, platform, url")
    .eq("campaign_id", campaignId);

  for (const entry of entries ?? []) {
    const count = await fetchViewCount(entry.platform as Platform, entry.url);
    if (count !== null) {
      await supabase.rpc("record_entry_views", {
        p_entry_id: entry.id,
        p_views: count,
      });
    }
  }

  campaignsPaths(slug, campaignId).forEach((p) => revalidatePath(p));
}
