import "server-only";

/**
 * Google Drive helpers — Phase 1 of the video strategy.
 *
 * Editors share files as "anyone with the link". We validate that at
 * submission time (the #1 failure mode is a forgotten sharing toggle), then
 * resolve a direct stream URL for SIFT's own <video> player so the review
 * room owns `currentTime` — which is what makes timestamp pins possible.
 */

const DRIVE_ID_RE = [
  /\/file\/d\/([a-zA-Z0-9_-]{20,})/, // /file/d/<id>/view
  /[?&]id=([a-zA-Z0-9_-]{20,})/, // ...?id=<id>
];

export function parseDriveFileId(url: string): string | null {
  if (!url) return null;
  for (const re of DRIVE_ID_RE) {
    const m = url.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

type VerifyResult = { ok: boolean; reason?: string };

/**
 * Confirms the file is publicly readable. Drive returns an HTML login/
 * permission page (or non-200) when it isn't. Best-effort with a timeout —
 * a network hiccup shouldn't hard-block delivery, so failures here are
 * reported but allow saving with verified=false.
 */
export async function verifyPublicAccess(fileId: string): Promise<VerifyResult> {
  try {
    const res = await fetch(
      `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`,
      {
        redirect: "follow",
        signal: AbortSignal.timeout(10_000),
        headers: { Range: "bytes=0-1023" },
      },
    );

    if (res.status === 200 || res.status === 206) return { ok: true };
    if (res.status === 403 || res.status === 401) {
      return {
        ok: false,
        reason:
          "Drive says this file isn't publicly shared. Set it to “Anyone with the link → Viewer”, then deliver again.",
      };
    }
    if (res.status === 404) {
      return { ok: false, reason: "Drive can't find that file ID — double-check the link." };
    }
    return { ok: false, reason: `Drive responded ${res.status}. Try again or re-share the file.` };
  } catch {
    // Unreachable/timeout: allow submission unverified rather than blocking.
    return { ok: false, reason: "Couldn't reach Drive to verify the link." };
  }
}

/**
 * Opens an upstream byte stream for the file, ready to proxy into our
 * <video> element. Walks Drive's large-file confirm interstitial server-side
 * (its hidden form fields must be echoed back), then returns the live
 * Response so the caller can pipe `body` straight through with the original
 * 200/206 status. The caller must strip Content-Disposition — Drive marks
 * these responses `attachment`, which Chrome's media stack refuses to play.
 */
export async function openDriveStream(
  fileId: string,
  range: string | null,
): Promise<Response | null> {
  const base = `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download`;
  const headers: HeadersInit = range ? { Range: range } : {};

  try {
    // Timeout guards the handshake only — cleared once headers arrive so the
    // body stream can run for the full length of the video.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res = await fetch(base, {
      redirect: "follow",
      headers,
      signal: controller.signal,
    });
    clearTimeout(timer);

    // Large files answer with an HTML confirm form instead of bytes.
    if (res.headers.get("content-type")?.includes("text/html")) {
      const html = await res.text();
      const params = new URLSearchParams();
      for (const input of html.matchAll(/<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"/g)) {
        params.set(input[1], input[2]);
      }
      if (params.size === 0) params.set("confirm", "t");
      res = await fetch(`${base}&${params.toString()}`, { redirect: "follow", headers });
    }

    if (res.status !== 200 && res.status !== 206) return null;
    return res;
  } catch {
    return null;
  }
}
