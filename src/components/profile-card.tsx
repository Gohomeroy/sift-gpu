"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "@/components/ui/avatar";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";

type ProfileData = {
  display_name: string;
  avatar_url: string | null;
  bio: string | null;
  skills: string[];
};

export function ProfileCard({
  open,
  onClose,
  slug,
  organizationId,
  userId,
  fallbackName,
  online,
  canSend,
}: {
  open: boolean;
  onClose: () => void;
  slug: string;
  organizationId: string;
  userId: string;
  fallbackName: string;
  online: boolean;
  canSend: boolean;
}) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [reputation, setReputation] = useState<{
    avg: number | null;
    reviews: number;
    completed: number;
  } | null>(null);
  const [dmBusy, setDmBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const supabase = createClient();

    void (async () => {
      const [{ data: p }, { data: reviews }, { data: completed }] =
        await Promise.all([
          supabase
            .from("profiles")
            .select("display_name, avatar_url, bio, skills")
            .eq("id", userId)
            .maybeSingle(),
          supabase
            .from("reviews")
            .select("rating")
            .eq("organization_id", organizationId)
            .eq("editor_id", userId),
          supabase
            .from("submissions")
            .select("id")
            .eq("organization_id", organizationId)
            .eq("editor_id", userId)
            .eq("status", "approved"),
        ]);

      if (p) {
        setProfile({
          display_name: p.display_name,
          avatar_url: p.avatar_url,
          bio: p.bio,
          skills: p.skills ?? [],
        });
      } else {
        setError("Couldn't load this profile.");
      }

      if ((reviews ?? []).length > 0) {
        const avg = reviews!.reduce((s, r) => s + r.rating, 0) / reviews!.length;
        setReputation({ avg, reviews: reviews!.length, completed: completed?.length ?? 0 });
      } else {
        setReputation({ avg: null, reviews: 0, completed: completed?.length ?? 0 });
      }
    })();
  }, [open, userId, organizationId]);

  async function startDm() {
    setDmBusy(true);
    setError(null);
    const supabase = createClient();
    const { data: threadId, error: rpcErr } = await supabase.rpc(
      "open_dm_thread",
      { p_org: organizationId, p_other_user: userId },
    );
    setDmBusy(false);
    if (rpcErr || !threadId) {
      setError(rpcErr ? rpcErr.message : "Couldn't open the conversation.");
      return;
    }
    onClose();
    router.push(`/o/${slug}/chat?dm=${threadId}`);
  }

  return (
    <Modal open={open} onClose={onClose} title="Profile">
      {!profile ? (
        error ? (
          <Alert kind="error">{error}</Alert>
        ) : (
          <div className="flex items-center gap-3">
            <div className="size-12 animate-pulse rounded-full bg-raised" />
            <div className="h-4 w-32 animate-pulse rounded bg-raised" />
          </div>
        )
      ) : (
        <div className="grid gap-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Avatar
                name={profile.display_name}
                url={profile.avatar_url ?? undefined}
                size="lg"
              />
              <span
                title={online ? "Online" : "Offline"}
                aria-label={online ? "Online" : "Offline"}
                className={`absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-panel ${
                  online ? "bg-ok" : "bg-line-strong"
                }`}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink">
                {profile.display_name}
                {!profile.display_name && fallbackName ? ` (${fallbackName})` : ""}
              </p>
              <p
                className={`font-mono text-[10px] tracking-[0.08em] uppercase ${
                  online ? "text-ok" : "text-faint"
                }`}
              >
                {online ? "online" : "offline"}
              </p>
            </div>
          </div>

          {profile.bio && <p className="text-sm text-muted">{profile.bio}</p>}

          {reputation && (reputation.reviews > 0 || reputation.completed > 0) && (
            <p className="rounded-md border border-line bg-raised/60 px-2.5 py-1.5 font-mono text-[11px] text-muted">
              {reputation.avg !== null && (
                <>
                  <span className="text-accent">★</span> {reputation.avg.toFixed(1)}
                  {" · "}
                </>
              )}
              {reputation.reviews} review{reputation.reviews === 1 ? "" : "s"}
              {" · "}
              {reputation.completed} completed in this workspace
            </p>
          )}

          {profile.skills.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {profile.skills.map((s) => (
                <span
                  key={s}
                  className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] text-muted"
                >
                  {s}
                </span>
              ))}
            </div>
          )}

          {canSend && userId && (
            <button
              type="button"
              onClick={() => void startDm()}
              disabled={dmBusy}
              className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-3.5 text-sm font-medium text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-wait disabled:opacity-60"
            >
              <MessageSquare size={14} />
              {dmBusy ? "Opening…" : "Message"}
            </button>
          )}

          {error && <Alert kind="error">{error}</Alert>}
        </div>
      )}
    </Modal>
  );
}
