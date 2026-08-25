"use client";

import { useRef, useState, useActionState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setBannerAction, removeBannerAction } from "@/app/actions/branding";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const MAX_BANNER_BYTES = 5 * 1024 * 1024;

export function BannerForm({
  slug,
  organizationId,
  bannerUrl,
}: {
  slug: string;
  organizationId: string;
  bannerUrl: string | null;
}) {
  const [state, action, pending] = useActionState(setBannerAction, emptyState);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > MAX_BANNER_BYTES) {
      setLocalError("Banners are capped at 5MB.");
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
      const path = `${organizationId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("workspace-banners")
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const fd = new FormData();
      fd.set("path", path);
      fd.set("slug", slug);
      action(fd);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      {bannerUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={bannerUrl}
          alt="Workspace banner"
          className="h-32 w-full rounded-md border border-line object-cover"
        />
      )}

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
          loading={busy || pending}
          onClick={() => fileRef.current?.click()}
        >
          {!busy && <ImagePlus size={13} />} {bannerUrl ? "Replace banner" : "Upload banner"}
        </Button>
        {bannerUrl && (
          <form action={removeBannerAction}>
            <input type="hidden" name="slug" value={slug} />
            <Button type="submit" variant="ghost" size="sm">
              <Trash2 size={13} /> Remove
            </Button>
          </form>
        )}
      </div>

      {(localError || state.error) && (
        <Alert kind="error">{localError ?? state.error}</Alert>
      )}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <p className="font-mono text-[10px] text-faint">
        Wide images work best (1500×500-ish) · 5MB max · shown on the workspace
        overview
      </p>
    </div>
  );
}
