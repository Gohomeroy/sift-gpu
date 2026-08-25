"use client";

import { useEffect, useRef, useState, useActionState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { createCampaignAction } from "@/app/actions/campaigns";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";

const MAX_BANNER_BYTES = 5 * 1024 * 1024;

export function NewCampaignForm({
  slug,
  organizationId,
}: {
  slug: string;
  organizationId: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createCampaignAction, emptyState);
  const [bannerPath, setBannerPath] = useState<string | null>(null);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const campaignId = state.success?.startsWith("CAMPAIGN:")
    ? state.success.slice("CAMPAIGN:".length)
    : null;

  useEffect(() => {
    if (campaignId && open) {
      router.push(`/o/${slug}/campaigns/${campaignId}`);
    }
  }, [campaignId, open, router, slug]);

  async function handleFile(file: File) {
    if (file.size > MAX_BANNER_BYTES) {
      setUploadError("Banners are capped at 5MB.");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const supabase = createClient();
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
      const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("campaign-banners")
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      setBannerPath(path);
      setBannerUrl(
        supabase.storage.from("campaign-banners").getPublicUrl(path).data.publicUrl,
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover"
      >
        <Plus size={15} /> New campaign
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="New campaign">
        <form action={action} className="grid gap-4">
          <input type="hidden" name="organization_id" value={organizationId} />
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="banner_path" value={bannerPath ?? ""} />

          <Field label="Title" htmlFor="c-title">
            <Input
              id="c-title"
              name="title"
              required
              minLength={3}
              maxLength={80}
              placeholder="October clipping push"
            />
          </Field>

          <Field
            label="Brief"
            hint="What should people post, where, and what makes an entry win?"
            htmlFor="c-brief"
          >
            <Textarea
              id="c-brief"
              name="brief"
              rows={4}
              required
              minLength={10}
              maxLength={2000}
              placeholder="Post a TikTok cutting our latest highlight. Use the sound, tag the account…"
            />
          </Field>

          <Field
            label="Reward text (optional)"
            hint="Shown on the card — e.g. “Clipping push for October”."
            htmlFor="c-reward"
          >
            <Input
              id="c-reward"
              name="reward_text"
              maxLength={120}
              placeholder="Post our highlight on TikTok"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Pay per 1k views (optional)"
              hint="Leave blank for a display-only campaign."
              htmlFor="c-rate"
            >
              <Input id="c-rate" name="rate_per_1k_views" type="number" min={0} step="0.01" placeholder="e.g. 1.00" />
            </Field>
            <Field
              label="Max payout per video (optional)"
              hint="Hard cap — e.g. 200 means $200 max per clip."
              htmlFor="c-cap"
            >
              <Input id="c-cap" name="max_payout_per_entry" type="number" min={0} step="0.01" placeholder="e.g. 200" />
            </Field>
          </div>

          <Field
            label="Banner (optional)"
            hint="A SIFT default is assigned when you skip this."
          >
            <div className="flex items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                  e.target.value = "";
                }}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                loading={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {bannerUrl ? "Replace banner" : "Upload banner"}
              </Button>
              {uploadError && <span className="text-xs text-err">{uploadError}</span>}
            </div>
            {bannerUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bannerUrl}
                alt="Campaign banner preview"
                className="mt-2 h-20 w-full rounded-md border border-line object-cover"
              />
            )}
          </Field>

          {state.error && <Alert kind="error">{state.error}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={pending}>
              Launch campaign
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
