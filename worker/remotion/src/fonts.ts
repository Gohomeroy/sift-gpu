/*
 * Fonts for the viral caption styles, loaded at render time from local
 * node_modules via @remotion/google-fonts (no network during renders).
 */
import { loadFont as loadAnton } from "@remotion/google-fonts/Anton";
import { loadFont as loadBebasNeue } from "@remotion/google-fonts/BebasNeue";
import { loadFont as loadMontserrat } from "@remotion/google-fonts/Montserrat";
import { loadFont as loadPoppins } from "@remotion/google-fonts/Poppins";

const anton = loadAnton();
const bebas = loadBebasNeue();
const montserrat = loadMontserrat("normal", { weights: ["700", "800"] });
const poppins = loadPoppins("normal", { weights: ["600", "800"] });

let loaded = false;

/** Call once before rendering so every family is registered. */
export function ensureFonts(): void {
  if (loaded) return;
  // Touching each family forces its @font-face registration.
  void [anton.fontFamily, bebas.fontFamily, montserrat.fontFamily, poppins.fontFamily];
  loaded = true;
}

export function fontFamilyFor(style: string): string {
  switch (style) {
    case "hormozi":
      return anton.fontFamily;
    case "beast":
      return poppins.fontFamily;
    case "karaoke":
      return montserrat.fontFamily;
    case "boxed":
      return montserrat.fontFamily;
    case "minimal":
      return poppins.fontFamily;
    default:
      return anton.fontFamily;
  }
}
