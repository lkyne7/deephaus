/**
 * DeepHaus mobile design tokens, derived from the shared tokens in
 * `@deephaus/shared` so web and mobile can't drift. The legacy semantic keys
 * (`bgCanvas`, `fgPrimary`, `gray*`, `brand*`, ...) map onto the same values.
 * Semantic tokens switch between palettes via ThemeProvider.
 */

import { designColors, designRadius } from "@deephaus/shared";
import { Platform } from "react-native";

export type ThemePreference = "light" | "dark" | "midnight" | "system";

type DesignPalette = (typeof designColors)[keyof typeof designColors];
type GrayRamp = DesignPalette["gray"];

function grayKeys(gray: { [K in keyof GrayRamp]: string }) {
  return {
    gray25: gray[25],
    gray50: gray[50],
    gray100: gray[100],
    gray200: gray[200],
    gray300: gray[300],
    gray400: gray[400],
    gray500: gray[500],
    gray600: gray[600],
    gray700: gray[700],
    gray800: gray[800],
    gray900: gray[900],
  };
}

/** Hex to rgba, for tints the shared tokens don't spell out. */
function tint(hex: string, alpha: number) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

function semanticColors(d: DesignPalette, scheme: "light" | "dark") {
  const isDark = scheme === "dark";
  const soft = isDark ? 0.14 : 0.1;
  const edge = isDark ? 0.3 : 0.24;
  return {
    black: "#000000",
    white: "#FFFFFF",
    ...grayKeys(d.gray),

    // Teal is the only accent; the old brand ramp collapses onto it.
    brand25: tint(d.accent, isDark ? 0.08 : 0.06),
    brand50: d.accentSoft,
    brand100: tint(d.accent, isDark ? 0.2 : 0.16),
    brand200: tint(d.accent, isDark ? 0.28 : 0.24),
    brand300: d.heat[2],
    brand400: d.heat[3],
    brand500: d.accent,
    brand600: d.accent,
    brand700: d.accentInk,
    brand800: d.accentHover,
    brand900: d.accentInk,

    // Orange only ever means due.
    orange25: tint(d.dueDot, isDark ? 0.08 : 0.06),
    orange50: d.dueSoft,
    orange100: tint(d.dueDot, isDark ? 0.2 : 0.16),
    orange200: tint(d.dueDot, isDark ? 0.28 : 0.24),
    orange300: d.projected[2],
    orange400: d.dueDot,
    orange500: d.dueDot,
    orange600: d.due,
    orange700: d.due,

    gradeAgain: d.grade.again,
    gradeHard: d.grade.hard,
    gradeGood: d.grade.good,
    gradeEasy: d.grade.easy,
    gradeAgainBg: tint(d.grade.again, soft),
    gradeAgainBorder: tint(d.grade.again, edge),
    gradeHardBg: tint(d.grade.hard, soft),
    gradeHardBorder: tint(d.grade.hard, edge),
    gradeGoodBg: tint(d.grade.good, soft),
    gradeGoodBorder: tint(d.grade.good, edge),
    gradeEasyBg: tint(d.grade.easy, soft),
    gradeEasyBorder: tint(d.grade.easy, edge),

    bgCanvas: d.canvas,
    bgSurface: d.surface,
    bgOverlay: d.scrim,
    bgRail: d.rail,
    bgSunken: d.sunken,
    bgHover: d.hover,
    bgActive: d.active,

    fgPrimary: d.ink,
    fgError: d.danger,
    fgSecondary: d.ink2,
    fgTertiary: d.ink3,
    fgQuaternary: d.ink3,
    fgPlaceholder: d.ink3,
    fgDisabled: d.gray[400],
    fgBrand: d.accentInk,
    fgOnBrand: d.onAccent,

    borderPrimary: d.lineStrong,
    borderSecondary: d.line,
    borderTertiary: d.hover,
    borderBrand: d.accent,

    actionPrimaryBg: d.ink,
    actionPrimaryFg: d.onInk,
    actionBrandBg: d.accent,
    actionBrandFg: d.onAccent,
    actionSecondaryBg: d.surface,
    actionSecondaryFg: d.ink,
    actionSecondaryBorder: d.lineStrong,
    actionTertiaryFg: d.ink2,
    actionDangerBg: d.danger,
    actionDangerFg: isDark ? d.gray[25] : "#FFFFFF",

    line: d.line,
    lineStrong: d.lineStrong,
    accent: d.accent,
    accentHover: d.accentHover,
    accentInk: d.accentInk,
    accentSoft: d.accentSoft,
    due: d.due,
    dueDot: d.dueDot,
    dueSoft: d.dueSoft,
    danger: d.danger,
    dangerSoft: d.dangerSoft,
    success: d.success,
    heat: d.heat as readonly string[],
    projected: d.projected as readonly string[],
  };
}

type Widened<T> = { [K in keyof T]: T[K] extends string ? string : T[K] };

export type ThemeColors = Widened<ReturnType<typeof semanticColors>>;

export const lightColors: ThemeColors = semanticColors(designColors.light, "light");

export const darkColors: ThemeColors = semanticColors(designColors.dark, "dark");

/** OLED theme: true black canvas, same accent and warm ink as dark. */
export const midnightColors: ThemeColors = {
  ...darkColors,

  gray25: "#000000",
  gray50: "#0D0C0B",
  gray100: "#181715",
  gray200: "#2A2926",
  gray300: "#45433E",

  bgCanvas: "#000000",
  bgSurface: "#141312",
  bgOverlay: "rgba(0, 0, 0, 0.72)",
  bgRail: "#0D0C0B",
  bgSunken: "#0D0C0B",

  actionSecondaryBg: "#141312",
  actionDangerFg: "#000000",
  actionPrimaryFg: "#000000",
};

/** @deprecated Use `useTheme().colors` instead. */
export const colors = lightColors;

export const spacing = {
  px1: 4,
  px2: 8,
  px3: 12,
  px4: 16,
  px5: 20,
  px6: 24,
  px8: 32,
  px10: 40,
  px12: 48,
  px16: 64,
  px20: 80,
} as const;

export const radius = {
  xs: 2,
  sm: 4,
  md: 6,
  lg: designRadius.control,
  xl: designRadius.input,
  xl2: 12,
  xl3: designRadius.card,
  xl4: designRadius.sheet,
  pill: designRadius.pill,
} as const;

/** Capsule on iOS (native UIButton / SwiftUI shape); 9px rectangle on Android. */
export const buttonRadius = Platform.OS === "ios" ? radius.pill : radius.lg;

/** Fixed content height for app top bars (below the status bar). */
export const layout = {
  appHeaderRowHeight: 56,
} as const;


export const typography = {
  display2xl: { fontSize: 72, lineHeight: 90, fontWeight: "600" as const },
  displayXl: { fontSize: 60, lineHeight: 72, fontWeight: "600" as const },
  displayLg: { fontSize: 48, lineHeight: 60, fontWeight: "600" as const },
  displayMd: { fontSize: 36, lineHeight: 44, fontWeight: "600" as const },
  displaySm: { fontSize: 30, lineHeight: 38, fontWeight: "600" as const },
  displayXs: { fontSize: 24, lineHeight: 32, fontWeight: "600" as const },
  textXl: { fontSize: 20, lineHeight: 30, fontWeight: "400" as const },
  textLg: { fontSize: 18, lineHeight: 28, fontWeight: "400" as const },
  textMd: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  textSm: { fontSize: 14, lineHeight: 20, fontWeight: "400" as const },
  textXs: { fontSize: 12, lineHeight: 18, fontWeight: "400" as const },
} as const;

export type ThemeShadow = {
  shadowColor: string;
  shadowOffset: { width: number; height: number };
  shadowOpacity: number;
  shadowRadius: number;
  elevation: number;
};

export type ThemeShadows = {
  xs: ThemeShadow;
  sm: ThemeShadow;
  md: ThemeShadow;
  lg: ThemeShadow;
};

const shadowXsLight = {
  shadowColor: "#2E281C",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.04,
  shadowRadius: 2,
  elevation: 1,
} as const;

const shadowSmLight = {
  shadowColor: "#2E281C",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 3,
  elevation: 1,
} as const;

const shadowMdLight = {
  shadowColor: "#2E281C",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 12,
  elevation: 3,
} as const;

const shadowLgLight = {
  shadowColor: "#2E281C",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.08,
  shadowRadius: 20,
  elevation: 6,
} as const;

const shadowXsDark = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.35,
  shadowRadius: 2,
  elevation: 1,
} as const;

const shadowSmDark = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.4,
  shadowRadius: 3,
  elevation: 2,
} as const;

const shadowMdDark = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.45,
  shadowRadius: 8,
  elevation: 4,
} as const;

const shadowLgDark = {
  shadowColor: "#000000",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.5,
  shadowRadius: 16,
  elevation: 8,
} as const;

export function createShadows(colorScheme: "light" | "dark"): ThemeShadows {
  if (colorScheme === "dark") {
    return { xs: shadowXsDark, sm: shadowSmDark, md: shadowMdDark, lg: shadowLgDark };
  }
  return { xs: shadowXsLight, sm: shadowSmLight, md: shadowMdLight, lg: shadowLgLight };
}

/** @deprecated Use `useTheme().shadows.xs` instead. */
export const shadowXs = shadowXsLight;
/** @deprecated Use `useTheme().shadows.sm` instead. */
export const shadowSm = shadowSmLight;
/** @deprecated Use `useTheme().shadows.md` instead. */
export const shadowMd = shadowMdLight;
/** @deprecated Use `useTheme().shadows.lg` instead. */
export const shadowLg = shadowLgLight;

/**
 * Legacy alias kept for compatibility with existing screens during the
 * design refresh. Prefer importing the named tokens above.
 */
export const theme = {
  colors: {
    background: lightColors.bgCanvas,
    surface: lightColors.bgSurface,
    border: lightColors.borderSecondary,
    text: lightColors.fgPrimary,
    muted: lightColors.fgTertiary,
    accent: lightColors.brand500,
    error: lightColors.fgError,
    success: lightColors.success,
    gradeAgain: lightColors.gradeAgain,
    gradeHard: lightColors.gradeHard,
    gradeGood: lightColors.gradeGood,
    gradeEasy: lightColors.gradeEasy,
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
    xl: 24,
  },
  radius: {
    sm: 8,
    md: 12,
    lg: 16,
  },
} as const;
