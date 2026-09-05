/** One-shot bundling + per-clip rendering with trim-to-length. */

import fs from "node:fs";
import path from "node:path";

import { bundle } from "@remotion/bundler";
import {
  getCompositions,
  renderMedia,
  selectComposition,
} from "@remotion/renderer";
import type { Cue } from "../src/components/Captions";

let cachedBundle: string | null = null;
const FPS = 30;

async function getBundle(entryPoint: string): Promise<string> {
  if (cachedBundle) return cachedBundle;
  cachedBundle = await bundle({
    entryPoint,
    onProgress: () => undefined,
  });
  return cachedBundle;
}

export async function renderClip(opts: {
  videoUrl: string;
  cues: Cue[];
  title: string;
  captionStyle: string;
  captionFont?: string;
  captionSub?: string;
  captionTheme?: string;
  durationSeconds: number;
  outName: string;
  outDir: string;
}): Promise<string> {
  const entryPoint = path.resolve(__dirname, "..", "src", "index.ts");
  const bundlePath = await getBundle(entryPoint);

  const inputProps = {
    videoUrl: opts.videoUrl,
    cues: opts.cues,
    title: opts.title,
    captionStyle: opts.captionStyle,
    captionFont: opts.captionFont,
    captionSub: opts.captionSub,
    captionTheme: opts.captionTheme,
    durationSeconds: opts.durationSeconds,
  };

  // selectComposition launches the browser probe — async in Remotion 4.
  const composition = await selectComposition({
    serveUrl: bundlePath,
    id: "ShortFormVideo",
    inputProps,
  });

  const frames = Math.max(1, Math.round(opts.durationSeconds * FPS));

  fs.mkdirSync(opts.outDir, { recursive: true });
  const outputPath = path.join(opts.outDir, `${opts.outName}.mp4`);

  await renderMedia({
    composition,
    serveUrl: bundlePath,
    codec: "h264",
    outputLocation: outputPath,
    inputProps,
    frameRange: [0, frames - 1],
    x264Preset: "faster",
    crf: 18,
  });

  return outputPath;
}
