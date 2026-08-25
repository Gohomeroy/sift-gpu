/**
 * SIFT clip render server.
 *
 * POST /render  { videoPath (inside RENDER_FILES_DIR), cues, title,
 *                 captionStyle, durationSeconds, outName }
 *   → renders 1080x1920 with captions burned in, writes
 *     <RENDER_FILES_DIR>/renders/<outName>.mp4, returns { outputPath }.
 * GET  /health  → ok
 *
 * The source cut is served to Remotion over http://127.0.0.1:<port>/clips/…
 * (OffthreadVideo requires an http URL — file:// paths fail in 4.x).
 */

import express from "express";
import path from "node:path";

import { renderClip } from "./render";

const PORT = Number(process.env.PORT || 3001);
const FILES_DIR = path.resolve(
  process.env.RENDER_FILES_DIR || process.cwd(),
);
const RENDER_OUT_DIR = path.join(FILES_DIR, "renders");

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use("/clips", express.static(FILES_DIR));

app.get("/health", (_req, res) => {
  res.json({ ok: true, filesDir: FILES_DIR });
});

app.post("/render", async (req, res) => {
  const {
    videoPath,
    cues = [],
    title = "",
    captionStyle = "hormozi",
    durationSeconds,
    outName,
  } = req.body ?? {};

  if (!videoPath || !outName || !durationSeconds) {
    res
      .status(400)
      .json({ error: "videoPath, durationSeconds and outName are required" });
    return;
  }

  const resolved = path.resolve(String(videoPath));
  if (!resolved.startsWith(FILES_DIR)) {
    res.status(403).json({ error: "videoPath must be inside RENDER_FILES_DIR" });
    return;
  }
  const rel = path.relative(FILES_DIR, resolved).split(path.sep).join("/");
  const videoUrl = `http://127.0.0.1:${PORT}/clips/${rel}`;

  try {
    const outputPath = await renderClip({
      videoUrl,
      cues: Array.isArray(cues) ? cues : [],
      title: String(title),
      captionStyle: String(captionStyle),
      durationSeconds: Number(durationSeconds),
      outName: String(outName).replace(/[^a-zA-Z0-9_-]/g, "_"),
      outDir: RENDER_OUT_DIR,
    });
    res.json({ outputPath });
  } catch (err) {
    console.error("[render] failed:", err);
    res.status(500).json({
      error: err instanceof Error ? err.message : "render failed",
    });
  }
});

app.listen(PORT, () => {
  console.log(`[sift-renderer] listening on http://127.0.0.1:${PORT}`);
});
