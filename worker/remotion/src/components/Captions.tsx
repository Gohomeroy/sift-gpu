import React from "react";
import { AbsoluteFill, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { fontFamilyFor } from "../fonts";

export type CueWord = { text: string; start: number; end: number };
export type Cue = { start: number; end: number; words: CueWord[] };

export type CaptionStyleName =
  | "hormozi"
  | "beast"
  | "karaoke"
  | "boxed"
  | "minimal";

export type CaptionStyleSpec = {
  fontSize: number;
  textTransform: "uppercase" | "none";
  baseColor: string;
  activeColor: string;
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
  boxedActive: boolean;
};

export const CAPTION_STYLES: Record<CaptionStyleName, CaptionStyleSpec> = {
  // Bold uppercase white, active word flips gold — the classic Hormozi look.
  hormozi: {
    fontSize: 118,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#FFD700",
    strokeWidth: 12,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: false,
  },
  // White words; the spoken word sits in a lime rounded box with black text.
  beast: {
    fontSize: 104,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#B7F000",
    strokeWidth: 10,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: true,
  },
  // Dimmed line, spoken word sweeps to full white with a slight scale.
  karaoke: {
    fontSize: 96,
    textTransform: "uppercase",
    baseColor: "rgba(255,255,255,0.42)",
    activeColor: "#FFFFFF",
    strokeWidth: 6,
    strokeColor: "rgba(0,0,0,0.85)",
    shadow: false,
    boxedActive: false,
  },
  // Every word in a black chip; the active chip burns yellow.
  boxed: {
    fontSize: 92,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#111111",
    strokeWidth: 0,
    strokeColor: "#000000",
    shadow: true,
    boxedActive: true,
  },
  // Clean sentence-case white, soft shadow, gentle scale on the active word.
  minimal: {
    fontSize: 84,
    textTransform: "none" as const,
    baseColor: "rgba(255,255,255,0.94)",
    activeColor: "#FFFFFF",
    strokeWidth: 0,
    strokeColor: "transparent",
    shadow: true,
    boxedActive: false,
  },
};

function strokeFor(spec: CaptionStyleSpec): React.CSSProperties {
  if (spec.strokeWidth > 0) {
    return {
      WebkitTextStroke: `${spec.strokeWidth}px ${spec.strokeColor}`,
      paintOrder: "stroke fill",
    } as React.CSSProperties;
  }
  if (spec.shadow) {
    return { textShadow: "0 4px 18px rgba(0,0,0,0.55)" };
  }
  return {};
}

/**
 * Viral word-pop captions: each cue's words scale in with a spring, and the
 * word being spoken right now takes the active treatment.
 */
export const Captions: React.FC<{ cues: Cue[]; style: string }> = ({ cues, style }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const spec = CAPTION_STYLES[(style as CaptionStyleName) in CAPTION_STYLES ? (style as CaptionStyleName) : "hormozi"];
  const now = frame / fps;

  const activeCueIndex = cues.findIndex((c) => now >= c.start && now < c.end);
  const visible = cues.slice(0, Math.max(activeCueIndex + 1, 1));
  const onScreen = visible.slice(-2); // current + previous line

  return (
    <AbsoluteFill style={{ justifyContent: "flex-end", alignItems: "center", paddingBottom: 340 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `0 ${spec.boxedActive ? 14 : 4}px`,
          padding: "0 120px",
        }}
      >
        {(onScreen.length ? onScreen : []).flatMap((cue, ci) =>
          cue.words.map((w, wi) => {
            const appearFrame = w.start * fps;
            const pop = spring({
              frame: frame - appearFrame,
              fps,
              config: { damping: 12, stiffness: 260, mass: 0.6 },
            });
            const isActive = now >= w.start && now < w.end;
            const activeScale = isActive ? 1.08 : 1;
            const scale = (ci === onScreen.length - 1 ? pop * activeScale : 1) || 1;

            const bg =
              spec.boxedActive && isActive
                ? spec.activeColor
                : spec.boxedActive
                  ? "rgba(0,0,0,0.82)"
                  : undefined;

            return (
              <span
                key={`${cue.start}-${wi}`}
                style={{
                  fontFamily: fontFamilyFor(style),
                  fontSize: spec.fontSize,
                  fontWeight: style === "hormozi" || style === "beast" ? 900 : 800,
                  lineHeight: 1.14,
                  textTransform: spec.textTransform,
                  color:
                    spec.boxedActive && isActive
                      ? "#111111"
                      : isActive
                        ? spec.activeColor
                        : spec.baseColor,
                  transform: `scale(${scale})`,
                  transformOrigin: "center bottom",
                  background: bg,
                  borderRadius: bg ? 22 : 0,
                  padding: bg ? "6px 20px" : 0,
                  margin: "8px 0",
                  display: "inline-block",
                  opacity: ci === onScreen.length - 1 ? Math.min(pop, 1) : 1,
                  transition: "none",
                  ...strokeFor(spec),
                }}
              >
                {w.text}
              </span>
            );
          }),
        )}
      </div>
    </AbsoluteFill>
  );
};
