import type { MetadataRoute } from "next";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://siftwine.dpdns.org";

  const staticPages = [
    { url: siteUrl, lastModified: new Date(), changeFrequency: "weekly" as const, priority: 0.8 },
    { url: `${siteUrl}/gallery`, lastModified: new Date(), changeFrequency: "daily" as const, priority: 0.9 },
  ];

  // Add individual clip pages
  try {
    const supabase = createAdminClient();
    const { data: clips } = await supabase
      .from("clips")
      .select("id, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    const clipPages = (clips ?? []).map((clip) => ({
      url: `${siteUrl}/gallery/${clip.id}`,
      lastModified: new Date(clip.created_at),
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));

    return [...staticPages, ...clipPages];
  } catch {
    return staticPages;
  }
}
