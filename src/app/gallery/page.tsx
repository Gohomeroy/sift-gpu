import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Clip } from "@/lib/types";
import { GalleryVideoCard } from "./gallery-video-card";

export const metadata: Metadata = {
  title: "Gallery",
  description:
    "Browse AI-generated viral clips from the SIFT pipeline. Short-form content with smart captions and face tracking.",
  openGraph: {
    title: "SIFT Gallery — AI Viral Clips",
    description: "AI-generated viral clips with smart captions and face tracking.",
    type: "website",
  },
};

type ClipWithUrl = Clip & { signedUrl: string };

async function getRecentClips(): Promise<ClipWithUrl[]> {
  const supabase = createAdminClient();

  const { data: clips } = await supabase
    .from("clips")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (!clips?.length) return [];

  const clipsWithUrls = await Promise.all(
    (clips as unknown as Clip[]).map(async (clip) => {
      const { data } = await supabase.storage
        .from("clips")
        .createSignedUrl(clip.storage_path, 3600 * 24);
      return { ...clip, signedUrl: data?.signedUrl ?? "" };
    }),
  );

  return clipsWithUrls.filter((c) => c.signedUrl);
}

function parseHashtags(raw: string[] | string | null): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

export default async function GalleryPage() {
  const clips = await getRecentClips();

  return (
    <div className="mx-auto max-w-6xl px-4 py-12">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Gallery</h1>
        <p className="mt-2 text-muted">
          AI-generated viral clips — smart captions, face tracking, hook overlays.
        </p>
      </header>

      {clips.length === 0 ? (
        <div className="rounded-lg border border-line bg-panel p-12 text-center">
          <p className="text-muted">No clips yet. Run a job to generate some.</p>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {clips.map((clip) => {
            const tags = parseHashtags(clip.hashtags);
            return (
              <a
                key={clip.id}
                href={`/gallery/${clip.id}`}
                className="group overflow-hidden rounded-xl border border-line bg-panel transition-colors hover:border-accent/40"
              >
                <GalleryVideoCard src={clip.signedUrl} viralScore={clip.viral_score} />
                <div className="p-3">
                  <h2 className="line-clamp-2 text-sm font-semibold">
                    {clip.title || "Untitled clip"}
                  </h2>
                  {clip.caption && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted">
                      {clip.caption}
                    </p>
                  )}
                  {tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded bg-raised px-1.5 py-0.5 text-[10px] text-faint"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
