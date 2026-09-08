/*
 * Caption text helpers for the Vizard-look renderer:
 *   - tokenize spikey transcript words into text + emoji runs
 *   - map an emoji grapheme to its Apple PNG asset name (codepoints.hex.png)
 *   - detect "special words" (numbers, power words, ALL-CAPS emphasis)
 *
 * Emoji assets are the Apple Color Emoji PNGs served locally by the render
 * server at <origin>/clips/emoji/<name>.png. Naming matches the emojiimages
 * npm package (Unicode codepoints joined by "-", lowercase, one hex per
 * codepoint, including VS16/ZWJ/skin-tone codepoints), e.g.
 *   🤩        1f929.png
 *   🌶️        1f336-fe0f.png
 *   👋🏻       1f44b-1f3fb.png
 *   👨‍👩‍👧  1f468-200d-1f469-200d-1f467.png
 *   🇺🇸       1f1fa-1f1f8.png
 */

export type TextRun =
  | { type: "text"; value: string }
  | { type: "emoji"; value: string };

// True for code points that make a grapheme an emoji (pictographic base,
// presentation form, regional indicator flags, keycaps, VS16, ZWJ, skintones).
// Text punctuation/digits are deliberately excluded.
const EMOJI_CODE_RE =
  /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\u{1F3FB}-\u{1F3FF}\u20E3\uFE0F\u200D]/u;

function graphemes(text: string): string[] {
  // Intl.Segmenter handles ZWJ/flag/skin-tone/VS16 clustering correctly;
  // fall back to greedy char runs when unavailable.
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segmented = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    return Array.from(segmented.segment(text), (s) => s.segment);
  }
  return Array.from(text);
}

/** Split a word's text into alternating text and emoji runs. */
export function splitTextRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  for (const g of graphemes(text)) {
    if (EMOJI_CODE_RE.test(g)) {
      runs.push({ type: "emoji", value: g });
    } else {
      const last = runs[runs.length - 1];
      if (last && last.type === "text") {
        last.value += g;
      } else {
        runs.push({ type: "text", value: g });
      }
    }
  }
  if (runs.length === 0) runs.push({ type: "text", value: text });
  return runs;
}

/** Apple emoji asset filename: lowercase hex codepoints joined by "-" + .png. */
export function emojiAssetName(emoji: string): string {
  const cps: string[] = [];
  for (const ch of emoji) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined) cps.push(cp.toString(16));
  }
  return cps.join("-") + ".png";
}

/** Words the renderer should always emphasize (Vizard-style keyword glow). */
const POWER_WORDS = new Set([
  "free", "secret", "never", "always", "best", "worst", "biggest", "smallest",
  "huge", "crazy", "insane", "guaranteed", "guarantee", "literally", "actually",
  "exactly", "impossible", "nobody", "everyone", "everybody", "million",
  "billion", "billions", "first", "last", "moment", "now", "watch", "wait",
  "listen", "look", "stop", "wow", "bet", "money", "cash", "rich", "secret",
  "hack", "trick", "easy", "hard", "fast", "fastest", "pov",
]);

/** True for words that deserve a colored glow: numbers/%, currency, power words, ALL-CAPS. */
export function isSpecialWord(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/[\d%$€£₹]/.test(t)) return true;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 2 && t === t.toUpperCase()) return true;
  return POWER_WORDS.has(t.toLowerCase().replace(/[^a-z]/g, ""));
}

/** Vivid accent palette for special words — deterministic per word. */
export const SPECIAL_ACCENTS = [
  "#FFD700", // gold
  "#FF6B9D", // pink
  "#41E0FF", // cyan
  "#B7F000", // lime
  "#FF9500", // orange
];

export function accentForWord(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return SPECIAL_ACCENTS[Math.abs(h) % SPECIAL_ACCENTS.length];
}