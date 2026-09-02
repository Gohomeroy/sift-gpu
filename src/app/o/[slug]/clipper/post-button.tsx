"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { PostModal } from "./post-modal";
import type { Clip, LinkedAccount, ClipPost } from "@/lib/types";

export function PostButton({
  clip,
  url,
  accounts,
  posts,
  slug,
}: {
  clip: Clip;
  url: string | null;
  accounts: LinkedAccount[];
  posts: ClipPost[];
  slug: string;
}) {
  const [open, setOpen] = useState(false);

  const clipPosts = posts.filter((p) => p.clip_id === clip.id);
  const hasPosted = clipPosts.some((p) => p.status === "posted");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 font-mono text-[10px] text-faint transition-colors hover:border-accent hover:text-accent"
      >
        <Share2 size={11} />
        {hasPosted ? "POSTED" : "POST"}
      </button>

      {open && (
        <PostModal
          clip={clip}
          url={url}
          accounts={accounts}
          posts={clipPosts}
          slug={slug}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
