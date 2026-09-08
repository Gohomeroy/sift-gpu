import React, { useState } from "react";
import {
  AbsoluteFill,
  Img,
  spring,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { fontFamilyFor } from "../fonts";
import {
  splitTextRuns,
  emojiAssetName,
  isSpecialWord,
  accentForWord,
} from "./captionText";

export type CueWord = { text: string; start: number; end: number };
export type Cue = { start: number; end: number; words: CueWord[] };

export type CaptionStyleName =
  | "karaoke"
  | "pill"
  | "boxed"
  | "minimal"
  | "two_tone"
  | "pop"
  | "vizard";
export type CaptionSubName =
  | "plain"
  | "bounce"
  | "fade"
  | "zoom"
  | "wave"
  | "rotate";
export type CaptionThemeName =
  | "pop"
  | "karaoke"
  | "hustle"
  | "grape"
  | "beast"
  | "poppin"
  | "vizard";

export type CaptionStyleSpec = {
  fontSize: number;
  textTransform: "uppercase" | "none";
  baseColor: string;
  activeColor: string;
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
  boxedActive: boolean;
  // Vizard-look extras (off for every legacy style, so nothing changes).
  font?: string; // force a family (vizard → montserrat)
  strokeGlow?: boolean; // soft outer glow on active + special words
  colorAccents?: boolean; // let special words break out in accent colors
};

export const CAPTION_STYLES: Record<CaptionStyleName, CaptionStyleSpec> = {
  // White letters, active word sweeps to bright yellow. The clean karaoke look.
  karaoke: {
    fontSize: 64,
    textTransform: "uppercase",
    baseColor: "rgba(255,255,255,0.45)",
    activeColor: "#FFD700",
    strokeWidth: 5,
    strokeColor: "rgba(0,0,0,0.9)",
    shadow: false,
    boxedActive: false,
  },
  // Rounded white pill behind each word; the spoken word's pill turns yellow.
  pill: {
    fontSize: 52,
    textTransform: "uppercase",
    baseColor: "#111111",
    activeColor: "#111111",
    strokeWidth: 0,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: true,
    // pill rendering uses a light box (overridden in render)
  },
  // Every word on a black rectangular chip; the active chip burns yellow.
  boxed: {
    fontSize: 56,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#FFD700",
    strokeWidth: 0,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: true,
  },
  // Thin, quiet uppercase — active word brightens to full white. Subtle.
  minimal: {
    fontSize: 44,
    textTransform: "uppercase",
    baseColor: "rgba(255,255,255,0.55)",
    activeColor: "#FFFFFF",
    strokeWidth: 0,
    strokeColor: "transparent",
    shadow: true,
    boxedActive: false,
  },
  // White letters with a heavy black outline; active word flips yellow.
  two_tone: {
    fontSize: 64,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#FFD700",
    strokeWidth: 9,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: false,
  },
  // The classic CapCut pop: bold white caps, black outline, active pops yellow.
  pop: {
    fontSize: 68,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#FFD700",
    strokeWidth: 10,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: false,
  },
  // The Vizard viral look: Montserrat ExtraBold caps, heavy black outline,
  // golden active pop, special words (numbers, power words) glow in accent
  // colors, and Apple-style emojis render as real PNG assets.
  vizard: {
    fontSize: 66,
    textTransform: "uppercase",
    baseColor: "#FFFFFF",
    activeColor: "#FFE600",
    strokeWidth: 9,
    strokeColor: "#000000",
    shadow: false,
    boxedActive: false,
    font: "montserrat",
    strokeGlow: true,
    colorAccents: true,
  },
};

// Theme palettes override the base + active colors (and sometimes add a bg).
export type Theme = {
  baseColor: string;
  activeColor: string;
  background: string | undefined;
  strokeWidth: number;
  strokeColor: string;
};

export const CAPTION_THEMES: Record<CaptionThemeName, Theme> = {
  pop: {
    baseColor: "#FFFFFF",
    activeColor: "#FFD700",
    background: undefined,
    strokeWidth: 9,
    strokeColor: "#000000",
  },
  karaoke: {
    baseColor: "rgba(255,255,255,0.45)",
    activeColor: "#FFD700",
    background: undefined,
    strokeWidth: 5,
    strokeColor: "rgba(0,0,0,0.9)",
  },
  hustle: {
    baseColor: "rgba(255,255,255,0.75)",
    activeColor: "#FFC107",
    background: undefined,
    strokeWidth: 7,
    strokeColor: "#111111",
  },
  grape: {
    baseColor: "#FFFFFF",
    activeColor: "#C9A5FF",
    background: "rgba(56, 18, 92, 0.88)",
    strokeWidth: 4,
    strokeColor: "#000000",
  },
  beast: {
    baseColor: "#FFFFFF",
    activeColor: "#B7F000",
    background: undefined,
    strokeWidth: 6,
    strokeColor: "#000000",
  },
  poppin: {
    baseColor: "#FFFFFF",
    activeColor: "#FF5C8A",
    background: undefined,
    strokeWidth: 5,
    strokeColor: "#000000",
  },
  // Gold active on pure white — pairs with the vizard style's extra bold.
  vizard: {
    baseColor: "#FFFFFF",
    activeColor: "#FFE600",
    background: undefined,
    strokeWidth: 9,
    strokeColor: "#000000",
  },
};

function strokeFor(spec: {
  strokeWidth: number;
  strokeColor: string;
  shadow: boolean;
}): React.CSSProperties {
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

export type SubAnimStyle = "plain" | "bounce" | "fade" | "zoom" | "wave" | "rotate";

/** Inline Apple-style emoji: renders the local PNG, falls back to the glyph. */
const EmojiGlyph: React.FC<{
  emoji: string;
  baseUrl: string;
  size: number;
}> = ({ emoji, baseUrl, size }) => {
  const [failed, setFailed] = useState(false);
  if (!baseUrl) {
    return <span style={{ fontSize: size }}>{emoji}</span>;
  }
  const src = `${baseUrl}/${emojiAssetName(emoji)}`;
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        verticalAlign: "-0.12em",
        margin: "0 3px",
      }}
    >
      <Img
        src={src}
        width={size}
        height={size}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    </span>
  );
};

/**
 * Word-pop captions renderer.
 *
 * Dimensions combine independently:
 *   - style   → base font size, box behavior, capitalization, vizard extras
 *   - theme   → color palette (base/active/stroke/background)
 *   - sub     → animation of the spoken word (plain/bounce/fade/zoom/wave/rotate)
 *
 * Captions are vertically centered (slightly above the true center) and use a
 * much smaller size than the old 84-118px presets.
 */
export const Captions: React.FC<{
  cues: Cue[];
  style: string;
  font?: string;
  sub?: string;
  theme?: string;
  reframeStyle?: string;
  captionLayout?: string;
  emojiBaseUrl?: string;
}> = ({
  cues,
  style,
  font = "anton",
  sub = "zoom",
  theme = "pop",
  reframeStyle = "track",
  captionLayout = "center",
  emojiBaseUrl = "",
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // Blur reframes keep captions out of the sharp center strip: they sit in
  // the blurred band right below the unblurred footage and are scaled down so
  // they read as a lower-third instead of covering the video. Portrait blur
  // is full-bleed (no band), so main.py passes "center" for those.
  const belowFeed = captionLayout === "below_feed";
  const fontScale = belowFeed ? 0.72 : 1;
  const spec = CAPTION_STYLES[
    (style as CaptionStyleName) in CAPTION_STYLES
      ? (style as CaptionStyleName)
      : "pop"
  ];
  const palette = CAPTION_THEMES[
    (theme as CaptionThemeName) in CAPTION_THEMES
      ? (theme as CaptionThemeName)
      : "pop"
  ];
  const subAnim = (sub as SubAnimStyle) in CAPTION_SUBS ? (sub as SubAnimStyle) : "zoom";
  const now = frame / fps;

  const activeCueIndex = cues.findIndex((c) => now >= c.start && now < c.end);
  // On silence there is no active cue — render NOTHING. The old
  // Math.max(idx+1, 1) made it fall back to cues.slice(0, 1), so the FIRST
  // caption ("why") reappeared in every gap. Now show the previous + current
  // line only while a cue is actually on screen.
  const onScreen =
    activeCueIndex === -1
      ? []
      : cues.slice(Math.max(activeCueIndex - 1, 0), activeCueIndex + 1);

  return (
    <AbsoluteFill
      style={
        belowFeed
          ? {
              // Blur layout: a lower-third pinned just under the 16:9
              // foreground (which ends at 65.8% of 1920 height), centered.
              justifyContent: "flex-start",
              alignItems: "center",
              paddingTop: height * 0.665,
              paddingBottom: height * 0.03,
            }
          : {
              justifyContent: "center",
              alignItems: "center",
              paddingBottom: height * 0.06,
            }
      }
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: `0 ${spec.boxedActive ? 10 : 4}px`,
          padding: "0 90px",
          maxWidth: belowFeed ? width * 0.9 : width * 0.86,
        }}
      >
        {(onScreen.length ? onScreen : []).flatMap((cue) =>
          cue.words.map((w, wi) => {
            const isActive = now >= w.start && now < w.end;
            const appearFrame = w.start * fps;
            const pop = spring({
              frame: frame - appearFrame,
              fps,
              config: { damping: 12, stiffness: 260, mass: 0.6 },
            });

            // Sub animation transforms.
            const animStyle: React.CSSProperties = {};
            if (subAnim === "bounce") {
              const s = isActive ? 1 + 0.22 * Math.abs(Math.sin(now * 9)) : 1;
              animStyle.transform = `scale(${s})`;
            } else if (subAnim === "fade") {
              animStyle.opacity = isActive ? 1 : Math.max(pop, 0.5);
            } else if (subAnim === "zoom") {
              const z = isActive ? 1.12 : pop;
              animStyle.transform = `scale(${z || 1})`;
            } else if (subAnim === "wave") {
              const rise = isActive ? Math.sin(now * 7) * -14 : 0;
              animStyle.transform = `translateY(${rise}px)`;
            } else if (subAnim === "rotate") {
              const r = isActive ? interpolate(Math.sin(now * 6), [-1, 1], [-6, 6]) : 0;
              animStyle.transform = `rotate(${r}deg)`;
            } else {
              // plain
              animStyle.transform = `scale(${Math.min(pop, 1)})`;
            }
            // The active word always gets a gentle scale bump unless its anim
            // already provides one.
            if (!["bounce", "zoom", "rotate"].includes(subAnim) && isActive) {
              animStyle.transform = animStyle.transform
                ? `${animStyle.transform} scale(1.08)`
                : "scale(1.08)";
            }
            animStyle.transformOrigin = "center bottom";

            // Resolve colors — the box styles get a box, others inherit stroke.
            const isBox = spec.boxedActive;
            const isPill = style === "pill";
            const isMinimal = style === "minimal";
            const isSpecial =
              spec.colorAccents === true && isSpecialWord(w.text);
            const accent = isSpecial ? accentForWord(w.text) : null;
            const bg = isBox
              ? isActive
                ? palette.activeColor
                : isPill
                  ? "rgba(230,230,230,0.96)"
                  : palette.background ?? "rgba(0,0,0,0.82)"
              : palette.background;
            // Pills are light chips with dark text; everything else uses the theme palette.
            // Special words keep their accent color even while active (Vizard style).
            const color = isPill
              ? "#111111"
              : isBox
                ? isActive
                  ? "#111111"
                  : "#FFFFFF"
                : accent
                  ? accent
                  : isActive
                    ? palette.activeColor
                    : palette.baseColor;

            const effSpec = {
              ...spec,
              baseColor: palette.baseColor,
              activeColor: palette.activeColor,
              strokeWidth: isBox ? 0 : spec.strokeWidth || palette.strokeWidth,
              strokeColor: palette.strokeColor,
            };

            const lineIsCurrent = cue === onScreen[onScreen.length - 1];

            // Soft glow for Vizard: active + special words radiate their color.
            const glowOn = (isActive || (isSpecial && accent != null)) && spec.strokeGlow;
            const glowColor = accent ?? palette.activeColor;
            const glow = glowOn
              ? `0 ${Math.round(spec.strokeWidth * 0.35)}px ${
                  Math.round(spec.strokeWidth * 1.4)
                }px ${glowColor}, 0 0 ${
                  Math.round(spec.strokeWidth * 2.2)
                }px ${glowColor}, 0 0 ${
                  Math.round(spec.strokeWidth * 3.4)
                }px ${glowColor}`
              : undefined;

            const fontName =
              (spec.font && (font === "anton" || font === "impact")) || !font
                ? spec.font
                : font;

            const emojiSize = Math.round(spec.fontSize * fontScale * 0.95);

            return (
              <span
                key={`${cue.start}-${wi}`}
                style={{
                  fontFamily: fontFamilyFor(fontName as string),
                  fontSize: spec.fontSize * fontScale,
                  fontWeight:
                    isPill ? 800 : isMinimal ? 600 : 900,
                  lineHeight: 1.14,
                  textTransform: spec.textTransform,
                  color,
                  transform: animStyle.transform,
                  transformOrigin: animStyle.transformOrigin,
                  background: bg,
                  borderRadius: isPill ? 24 : 14,
                  padding: bg ? "6px 16px" : 0,
                  margin: "8px 0",
                  display: "inline-block",
                  opacity: isBox
                    ? 1
                    : lineIsCurrent
                      ? subAnim === "fade"
                        ? animStyle.opacity
                        : Math.min(1, 0.55 + pop * 0.45)
                      : 1,
                  transition: "none",
                  ...strokeFor(effSpec),
                  textShadow: glow ?? strokeFor(effSpec).textShadow,
                }}
              >
                {splitTextRuns(w.text).map((run, i) =>
                  run.type === "emoji" ? (
                    <EmojiGlyph
                      key={`${wi}-e${i}`}
                      emoji={run.value}
                      baseUrl={emojiBaseUrl}
                      size={emojiSize}
                    />
                  ) : (
                    <span key={`${wi}-t${i}`}>{run.value}</span>
                  ),
                )}
              </span>
            );
          }),
        )}
      </div>
    </AbsoluteFill>
  );
};

const CAPTION_SUBS: Record<SubAnimStyle, true> = {
  plain: true,
  bounce: true,
  fade: true,
  zoom: true,
  wave: true,
  rotate: true,
};