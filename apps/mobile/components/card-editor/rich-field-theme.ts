import type { CardFont } from "@/lib/study/card-font";
import type { ThemeColors } from "@/lib/theme";
import type { CardFieldRole, RichFieldTheme } from "@/components/card-editor/rich-field-types";

/**
 * Card text while editing. A step under study's 27/35 face so both sides of a
 * card stay in view above the keyboard; notes match study.
 */
export const CARD_FIELD_TYPE = {
  face: { fontSize: 25, lineHeight: 33 },
  note: { fontSize: 17, lineHeight: 25 },
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
    surface: colors.bgCanvas,
    selection: colors.brand200,
    accent: colors.accent,
    accentInk: colors.accentInk,
    accentSoft: colors.accentSoft,
    type: {
      family,
      ...CARD_FIELD_TYPE[role],
      color: role === "note" ? colors.fgTertiary : colors.fgPrimary,
    },
  };
}
