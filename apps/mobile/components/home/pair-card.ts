import { StyleSheet, type ViewStyle } from "react-native";
import { radius, type ThemeColors } from "@/lib/theme";

/**
 * The one recipe Home's review card and the composer share, so the two read
 * as a pair: same surface, corners and inset, content on top and a row of
 * pills with one accent action underneath.
 */
export function pairCardStyle(colors: ThemeColors): ViewStyle {
  return {
    gap: 10,
    paddingTop: 14,
    paddingHorizontal: 10,
    paddingBottom: 10,
    backgroundColor: colors.bgSurface,
    borderColor: colors.line,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 24,
  };
}

/** A grey pill in a card's bottom row. */
export function pairChipStyle(colors: ThemeColors): ViewStyle {
  return {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    backgroundColor: colors.bgSunken,
  };
}
