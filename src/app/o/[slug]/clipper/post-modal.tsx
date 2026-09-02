"use client";

import { useActionState } from "react";
import { X, Send, CheckCircle, XCircle, Clock, Loader2 } from "lucide-react";
import { createClipPostAction, cancelClipPostAction } from "@/app/actions/posting";
import { emptyState } from "@/lib/action-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { Chip } from "@/components/ui/chip";
import type { Clip, LinkedAccount, ClipPost } from "@/lib/types";

const PLATFORM_ICONS: Record<string, string> = {
  tiktok: "🎵",
  youtube: "📺",
  instagram: "📸",
  other: "🔗",
};

const STATUS_ICONS: Record<string, React.ReactNode> = {
  queued: <Clock size={12} className="text-faint" />,
  posting: <Loader2 size={12} className="animate-spin text-accent" />,
  posted: <CheckCircle size={12} className="text-ok" />,
  failed: <XCircle size={12} className="text-err" />,
  cancelled: <XCircle size={12} className="text-faint" />,
};

export function PostModal({
  clip,
  url,
  accounts,
  posts,
  slug,
  onClose,
}: {
  clip: Clip;
  url: string | null;
  accounts: LinkedAccount[];
  posts: ClipPost[];
  slug: string;
  onClose: () => void;
}) {
  const [state, action, pending] = useActionState(createClipPostAction, emptyState);

  const verifiedAccounts = accounts.filter((a) => a.verified_at);
  const clipPosts = posts.filter((p) => p.clip_id === clip.id);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="relative w-full max-w-lg rounded-lg border border-line bg-panel shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold text-ink">Post clip</h3>
            <p className="mt-0.5 text-xs text-muted truncate max-w-[300px]">
              {clip.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded p-1 text-faint transition-colors hover:bg-raised hover:text-ink"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="grid gap-4 p-4">
          {/* Clip preview */}
          <div className="flex gap-3">
            {url ? (
              <video src={url} className="h-24 w-14 rounded object-cover" muted />
            ) : (
              <div className="h-24 w-14 animate-pulse rounded bg-raised" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-ink truncate">{clip.title}</p>
              {clip.caption && (
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">{clip.caption}</p>
              )}
              {clip.viral_score !== null && (
                <Chip
                  tone={clip.viral_score >= 80 ? "ok" : clip.viral_score >= 65 ? "accent" : "neutral"}
                  className="mt-1"
                >
                  {clip.viral_score} viral
                </Chip>
              )}
            </div>
          </div>

          {/* Platform selection */}
          {verifiedAccounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-line p-3 text-center">
              <p className="text-xs text-muted">
                No verified accounts connected.
              </p>
              <a
                href="/profile"
                className="mt-1 inline-block text-xs text-accent hover:underline"
              >
                Connect accounts →
              </a>
            </div>
          ) : (
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
                Post to
              </legend>
              <div className="grid gap-1.5">
                {verifiedAccounts.map((account) => (
                  <label
                    key={account.id}
                    className="cursor-pointer flex items-center gap-2 rounded-md border border-line px-3 py-2 transition-colors hover:border-line-strong"
                  >
                    <input
                      type="radio"
                      name="account_id"
                      value={account.id}
                      defaultChecked={verifiedAccounts.length === 1}
                      className="peer sr-only"
                    />
                    <span className="text-lg">{PLATFORM_ICONS[account.platform] ?? "🔗"}</span>
                    <div className="flex-1">
                      <span className="text-sm font-medium text-ink peer-checked:text-accent">
                        {account.platform.charAt(0).toUpperCase() + account.platform.slice(1)}
                      </span>
                      <span className="ml-2 font-mono text-xs text-faint">
                        @{account.handle}
                      </span>
                    </div>
                    <span className="font-mono text-[10px] text-ok">VERIFIED</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {/* Caption */}
          <Field label="Caption" hint="Leave blank to use the AI-generated caption." htmlFor="post-caption">
            <Textarea
              id="post-caption"
              name="caption"
              rows={3}
              defaultValue={clip.caption ?? ""}
              placeholder="Write a caption or leave blank for AI default..."
            />
          </Field>

          {/* Hashtags */}
          <Field label="Hashtags" hint="Comma separated. AI defaults will be prepended." htmlFor="post-hashtags">
            <Input
              id="post-hashtags"
              name="hashtags"
              defaultValue={(() => {
                try {
                  const tags = Array.isArray(clip.hashtags)
                    ? clip.hashtags
                    : JSON.parse(clip.hashtags ?? "[]");
                  return tags.join(", ");
                } catch {
                  return "";
                }
              })()}
              placeholder="#fyp, #viral, #shorts"
            />
          </Field>

          {/* Hidden fields */}
          <input type="hidden" name="clip_id" value={clip.id} />
          <input type="hidden" name="slug" value={slug} />

          {state.error && <Alert kind="error">{state.error}</Alert>}
          {state.success && (
            <Alert kind="success">Post queued — the worker will upload it shortly.</Alert>
          )}

          {/* Submit */}
          <Button
            type="submit"
            formAction={action}
            loading={pending}
            disabled={verifiedAccounts.length === 0}
            className="justify-self-end"
          >
            {!pending && <Send size={13} />}
            Post now
          </Button>
        </div>

        {/* Existing posts for this clip */}
        {clipPosts.length > 0 && (
          <div className="border-t border-line px-4 py-3">
            <p className="mb-2 font-mono text-[10px] tracking-[0.08em] text-faint uppercase">
              Post history
            </p>
            <ul className="grid gap-1.5">
              {clipPosts.map((post) => (
                <li
                  key={post.id}
                  className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-xs"
                >
                  {STATUS_ICONS[post.status]}
                  <span className="font-medium text-ink">
                    {post.platform.charAt(0).toUpperCase() + post.platform.slice(1)}
                  </span>
                  {post.platform_url ? (
                    <a
                      href={post.platform_url}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto truncate text-accent hover:underline"
                    >
                      View post →
                    </a>
                  ) : post.error ? (
                    <span className="ml-auto truncate text-err">{post.error}</span>
                  ) : (
                    <span className="ml-auto text-faint">{post.status}</span>
                  )}
                  {post.status === "failed" && (
                    <form action={cancelClipPostAction}>
                      <input type="hidden" name="post_id" value={post.id} />
                      <input type="hidden" name="slug" value={slug} />
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
