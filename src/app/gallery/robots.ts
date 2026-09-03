import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://siftwine.dpdns.org";

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/gallery",
        disallow: ["/o/", "/api/", "/auth/"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
