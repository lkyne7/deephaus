import type { CardFont } from "@/lib/study/card-font";
import type { ThemeColors } from "@/lib/theme";
import type { CardFieldRole, RichFieldTheme } from "@/components/card-editor/rich-field-types";

/**
 * Card text while editing, set left in grouped fields: the card's serif for the
 * faces, the system face for the note (the E2 editor).
 */
export const CARD_FIELD_TYPE = {
  face: { fontSize: 19, lineHeight: 27 },
  note: { fontSize: 16, lineHeight: 22 },
} as const satisfies Record<CardFieldRole, { fontSize: number; lineHeight: number }>;

/** The subset of the native theme the editor web view needs. */
export function richFieldTheme(
  colors: ThemeColors,
  scheme: "light" | "dark",
  fontScale: number,
  role: CardFieldRole,
  family: CardFont,
): RichFieldTheme {
  return {
    scheme,
    fontScale,
    text: colors.fgPrimary,
    placeholder: colors.fgTertiary,
    muted: colors.fgTertiary,
    link: colors.accentInk,
    border: colors.line,
    codeBg: colors.bgSunken,
    surface: colors.bgSurface,
    selection: colors.brand200,
    accent: colors.accent,
    accentInk: colors.accentInk,
    accentSoft: colors.accentSoft,
    type: {
      family: role === "note" ? "system" : family,
      ...CARD_FIELD_TYPE[role],
      color: colors.fgPrimary,
    },
  };
}
