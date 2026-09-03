import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Clip } from "@/lib/types";

type Props = { params: Promise<{ clipId: string }> };

async function getClip(clipId: string): Promise<(Clip & { signedUrl: string }) | null> {
  const supabase = createAdminClient();

  const { data: clip } = await supabase
    .from("clips")
    .select("*")
    .eq("id", clipId)
    .single();

  if (!clip) return null;

  const { data } = await supabase.storage
    .from("clips")
    .createSignedUrl((clip as unknown as Clip).storage_path, 3600 * 24);

  if (!data?.signedUrl) return null;

  return { ...(clip as unknown as Clip), signedUrl: data.signedUrl };
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

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { clipId } = await params;
  const clip = await getClip(clipId);
  if (!clip) return { title: "Clip Not Found" };

  const title = clip.title || "AI Viral Clip";
  const description = clip.caption || title;
  const tags = parseHashtags(clip.hashtags);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://siftwine.dpdns.org";
  const clipUrl = `${siteUrl}/gallery/${clipId}`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url: clipUrl,
      type: "website",
      siteName: "SIFT",
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
    other: tags.length ? { keywords: tags.join(", ") } : undefined,
  };
}

export default async function ClipPage({ params }: Props) {
  const { clipId } = await params;
  const clip = await getClip(clipId);
  if (!clip) notFound();

  const tags = parseHashtags(clip.hashtags);
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://siftwine.dpdns.org";

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: clip.title || "AI Viral Clip",
    description: clip.caption || clip.title || "",
    thumbnailUrl: clip.signedUrl,
    contentUrl: clip.signedUrl,
    uploadDate: clip.created_at,
    width: 1080,
    height: 1920,
    duration: clip.end_seconds && clip.start_seconds
      ? `PT${Math.round(clip.end_seconds - clip.start_seconds)}S`
      : undefined,
    inLanguage: "en",
    interactionStatistic: clip.viral_score
      ? {
          "@type": "InteractionCounter",
          userInteractionCount: clip.viral_score,
          interactionType: "https://schema.org/LikeAction",
        }
      : undefined,
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="mx-auto max-w-2xl px-4 py-12">
        <nav className="mb-6 text-xs text-faint">
          <a href="/gallery" className="hover:text-accent">
            Gallery
          </a>
          <span className="mx-1.5">/</span>
          <span className="text-muted">{clip.title || "Clip"}</span>
        </nav>

        <div className="overflow-hidden rounded-xl border border-line bg-panel">
          <video
            src={clip.signedUrl}
            controls
            autoPlay
            className="aspect-[9/16] w-full bg-black object-cover"
          />
        </div>

        <div className="mt-4 space-y-3">
          <h1 className="text-xl font-bold">{clip.title || "Untitled clip"}</h1>

          {clip.viral_score != null && (
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-green-500/10 px-2 py-0.5 text-sm font-bold text-green-400">
                Viral Score: {clip.viral_score}
              </span>
              {clip.caption_style && (
                <span className="rounded-md bg-raised px-2 py-0.5 text-xs text-faint">
                  {clip.caption_style}
                </span>
              )}
            </div>
          )}

          {clip.caption && (
            <p className="text-sm text-muted">{clip.caption}</p>
          )}

          {clip.reasoning && (
            <div className="rounded-lg bg-raised p-3 text-xs text-faint">
              <span className="font-semibold text-muted">AI reasoning:</span>{" "}
              {clip.reasoning}
            </div>
          )}

          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full bg-raised px-2.5 py-1 text-xs text-faint"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          <div className="pt-2 text-xs text-faint">
            {clip.start_seconds != null && clip.end_seconds != null && (
              <span>
                {Math.round(clip.start_seconds)}s – {Math.round(clip.end_seconds)}s
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
