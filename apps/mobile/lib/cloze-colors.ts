/** Per-cloze palette — mirrors apps/web/src/app/globals.css (--cloze-cN-*). */
export type ClozePalette = { bg: string; fg: string; border: string };

export const clozePalettesLight: ClozePalette[] = [
  { bg: "#FFF3EB", fg: "#9C4221", border: "#F6AD55" },
  { bg: "#EBF8FF", fg: "#2C5282", border: "#63B3ED" },
  { bg: "#FAF5FF", fg: "#553C9A", border: "#B794F4" },
  { bg: "#ECFDF5", fg: "#065F46", border: "#34D399" },
  { bg: "#FFF5F7", fg: "#97266D", border: "#F687B3" },
  { bg: "#E6FFFA", fg: "#234E52", border: "#38B2AC" },
  { bg: "#FFFBEB", fg: "#92400E", border: "#FBBF24" },
  { bg: "#EEF2FF", fg: "#3730A3", border: "#818CF8" },
  { bg: "#ECFEFF", fg: "#155E75", border: "#22D3EE" },
];

export const clozePalettesDark: ClozePalette[] = [
  { bg: "rgba(246, 173, 85, 0.18)", fg: "#FBD38D", border: "#DD6B20" },
  { bg: "rgba(99, 179, 237, 0.18)", fg: "#90CDF4", border: "#3182CE" },
  { bg: "rgba(183, 148, 244, 0.18)", fg: "#D6BCFA", border: "#805AD5" },
  { bg: "rgba(52, 211, 153, 0.18)", fg: "#6EE7B7", border: "#059669" },
  { bg: "rgba(246, 135, 179, 0.18)", fg: "#F9A8D4", border: "#DB2777" },
  { bg: "rgba(56, 178, 172, 0.18)", fg: "#81E6D9", border: "#2C7A7B" },
  { bg: "rgba(251, 191, 36, 0.18)", fg: "#FCD34D", border: "#D97706" },
  { bg: "rgba(129, 140, 248, 0.18)", fg: "#A5B4FC", border: "#4338CA" },
  { bg: "rgba(34, 211, 238, 0.18)", fg: "#67E8F9", border: "#0891B2" },
];

export function clozePaletteForOrd(
  ord: number,
  mode: "light" | "dark",
): ClozePalette {
  const palettes = mode === "dark" ? clozePalettesDark : clozePalettesLight;
  const index = Math.min(Math.max(ord, 1), 9) - 1;
  return palettes[index]!;
}
