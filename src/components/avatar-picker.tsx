"use client";

import { useRef, useState, useActionState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { setAvatarAction, removeAvatarAction } from "@/app/actions/branding";
import { emptyState } from "@/lib/action-state";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

export function AvatarPicker({
  userId,
  displayName,
  avatarUrl,
}: {
  userId: string;
  displayName: string;
  avatarUrl: string | null;
}) {
  const [state, action, pending] = useActionState(setAvatarAction, emptyState);
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    if (file.size > MAX_AVATAR_BYTES) {
      setLocalError("Photos are capped at 2MB.");
      return;
    }
    setLocalError(null);
    setBusy(true);
    try {
      const supabase = createClient();
      const ext = file.name.includes(".") ? file.name.split(".").pop() : "png";
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const fd = new FormData();
      fd.set("path", path);
      action(fd);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-4">
        <Avatar name={displayName} url={avatarUrl ?? undefined} size="lg" />
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
            {!busy && <ImagePlus size={13} />} Upload photo
          </Button>
          {avatarUrl && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={async () => {
                setBusy(true);
                await removeAvatarAction();
                setBusy(false);
              }}
            >
              <Trash2 size={13} /> Remove
            </Button>
          )}
        </div>
      </div>
      {(localError || state.error) && (
        <Alert kind="error">{localError ?? state.error}</Alert>
      )}
      {state.success && <Alert kind="success">{state.success}</Alert>}
      <p className="font-mono text-[10px] text-faint">
        PNG or JPG · square works best · 2MB max
      </p>
    </div>
  );
}
