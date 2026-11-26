import type { ThemeColors } from "@/lib/theme";
import type { RichFieldTheme } from "@/components/card-editor/rich-field-types";

/** The subset of the native theme the editor web view needs. */
export function richFieldTheme(
  colors: ThemeColors,
  scheme: "light" | "dark",
  fontScale: number,
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
  };
}
