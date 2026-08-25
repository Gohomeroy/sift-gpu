import "server-only";

/**
 * Best-effort platform integrations for account verification and view
 * tracking. These hit public endpoints — they can break when platforms
 * change; every caller treats failure as "couldn't verify/fetch" and the
 * UI says so honestly. No keys, no scraping logins.
 */

export type Platform = "tiktok" | "youtube" | "instagram" | "other";

function normalizeHandle(handle: string) {
  return handle.trim().replace(/^@/, "");
}

/** Fetches a profile's bio text and scans it for the verification code. */
export async function verifyAccountInBio(
  platform: Platform,
  handle: string,
  code: string,
): Promise<{ ok: boolean; reason: string }> {
  const h = normalizeHandle(handle);
  const upper = code.toUpperCase();

  const scan = (text: string, source: string) => {
    if (text.toUpperCase().includes(upper)) {
      return { ok: true, reason: "Verified." };
    }
    return {
      ok: false,
      reason: `Couldn't find ${code} in the ${source} bio yet — save the bio change, wait a minute, then try again.`,
    };
  };

  try {
    if (platform === "tiktok") {
      // 1) Public metadata endpoint.
      try {
        const res = await fetch(
          `https://www.tikwm.com/api/user/info?unique_id=${encodeURIComponent(h)}`,
          { signal: AbortSignal.timeout(10_000) },
        );
        if (res.ok) {
          const json = (await res.json()) as {
            data?: { user?: { signature?: string } };
          };
          const bio = json.data?.user?.signature ?? "";
          if (bio) return scan(bio, "TikTok");
        }
      } catch {
        // fall through to the next source
      }

      // 2) Direct profile page (bio appears in meta tags + embedded JSON).
      try {
        const res = await fetch(`https://www.tiktok.com/@${encodeURIComponent(h)}`, {
          signal: AbortSignal.timeout(10_000),
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)" },
        });
        if (res.ok) {
          const html = await res.text();
          if (html.toUpperCase().includes(upper)) return { ok: true, reason: "Verified." };
        }
      } catch {
        // fall through
      }

      // 3) Reader proxy — returns the page as plain text from different IPs.
      try {
        const res = await fetch(`https://r.jina.ai/https://www.tiktok.com/@${encodeURIComponent(h)}`, {
          signal: AbortSignal.timeout(20_000),
        });
        if (res.ok) {
          const text = await res.text();
          return scan(text, "TikTok");
        }
      } catch {
        // fall through
      }

      return {
        ok: false,
        reason:
          "TikTok is blocking verification right now — wait a minute and try again, or ask SIFT staff to verify manually.",
      };
    }

    if (platform === "youtube") {
      const res = await fetch(
        `https://www.youtube.com/@${encodeURIComponent(h)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return { ok: false, reason: `YouTube responded ${res.status}.` };
      return scan(await res.text(), "YouTube");
    }

    if (platform === "instagram") {
      const res = await fetch(
        `https://www.instagram.com/${encodeURIComponent(h)}/`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return { ok: false, reason: `Instagram responded ${res.status}.` };
      return scan(await res.text(), "Instagram");
    }

    return {
      ok: false,
      reason:
        "Automatic verification isn't available for this platform — a SIFT admin will check it manually.",
    };
  } catch {
    return { ok: false, reason: "Couldn't reach the platform — try again shortly." };
  }
}

/** Best-effort view count for a clip URL. Null when unavailable. */
export async function fetchViewCount(
  platform: Platform,
  url: string,
): Promise<number | null> {
  try {
    if (platform === "tiktok") {
      const res = await fetch(
        `https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`,
        { signal: AbortSignal.timeout(10_000) },
      );
      if (!res.ok) return null;
      const json = (await res.json()) as { data?: { play_count?: number } };
      const count = json.data?.play_count;
      return typeof count === "number" ? count : null;
    }
    if (platform === "youtube") {
      const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return null;
      const html = await res.text();
      const m = html.match(/"viewCount":"(\d+)"/);
      return m ? Number(m[1]) : null;
    }
    return null;
  } catch {
    return null;
  }
}
