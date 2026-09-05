/*
 * Fonts for the caption styles, loaded at render time from local
 * node_modules via @remotion/google-fonts (no network during renders).
 *
 * The six selectable fonts map to six Google families. "impact" is a
 * Microsoft-packaged font not on Google Fonts, so it renders with Anton
 * (the closest free condensed-black equivalent) — the shapes are near-identical.
 */
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";
import { loadFont as loadOutfit } from "@remotion/google-fonts/Outfit";
import { loadFont as loadRajdhani } from "@remotion/google-fonts/Rajdhani";

const anton = loadAnton();
const montserrat = loadMontserrat("normal", { weights: ["700", "800"] });
const poppins = loadPoppins("normal", { weights: ["600", "800"] });
const outfit = loadOutfit("normal", { weights: ["700", "800"] });
const rajdhani = loadRajdhani("normal", { weights: ["700"] });

let loaded = false;

/** Call once before rendering so every family is registered. */
export function ensureFonts(): void {
  if (loaded) return;
  // Touching each family forces its @font-face registration.
  void [
    anton.fontFamily,
    montserrat.fontFamily,
    poppins.fontFamily,
    outfit.fontFamily,
    rajdhani.fontFamily,
  ];
  loaded = true;
}

export type CaptionFontName =
  | "impact"
  | "anton"
  | "outfit"
  | "poppins"
  | "montserrat"
  | "rajdhani";

export function fontFamilyFor(font: string): string {
  switch (font) {
    case "outfit":
      return outfit.fontFamily;
    case "poppins":
      return poppins.fontFamily;
    case "montserrat":
      return montserrat.fontFamily;
    case "rajdhani":
      return rajdhani.fontFamily;
    case "anton":
    case "impact": // Impact → Anton stand-in (Microsoft font, not on Google Fonts)
    default:
      return anton.fontFamily;
  }
}