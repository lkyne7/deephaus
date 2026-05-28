/**
 * DeepHaus mobile design tokens — mirrors the shared Untitled UI design system.
 * Semantic tokens switch between light and dark palettes via ThemeProvider.
 */

export type ThemePreference = "light" | "dark" | "system";

const palette = {
  gray25: "#FCFCFD",
  gray50: "#F9FAFB",
  gray100: "#F2F4F7",
  gray200: "#EAECF0",
  gray300: "#D0D5DD",
  gray400: "#98A2B3",
  gray500: "#667085",
  gray600: "#475467",
  gray700: "#344054",
  gray800: "#1D2939",
  gray900: "#101828",
  black: "#000000",
  white: "#FFFFFF",

  brand25: "#F1FBFB",
  brand50: "#E7F8F8",
  brand100: "#D2EEEE",
  brand200: "#C3E1E1",
  brand300: "#7AC5C3",
  brand400: "#4FB3B1",
  brand500: "#319795",
  brand600: "#2C7A7B",
  brand700: "#1F5F5E",
  brand800: "#0D5856",
  brand900: "#083F3E",

  orange25: "#FFFAF5",
  orange50: "#FFF3EB",
  orange100: "#FEF0C7",
  orange200: "#FEDF89",
  orange300: "#FDB022",
  orange400: "#F38744",
  orange500: "#DD6B20",
  orange600: "#D26417",
  orange700: "#C05621",

  gradeAgain: "#F97066",
  gradeHard: "#D6BBFB",
  gradeGood: "#4FB3B1",
  gradeEasy: "#47CD89",
} as const;

export const lightColors = {
  ...palette,

  gradeAgainBg: "#FEF3F2",
  gradeAgainBorder: "#FECDCA",
  gradeHardBg: "#FDF4FF",
  gradeHardBorder: "#F4A8E9",
  gradeGoodBg: "#E7F8F8",
  gradeGoodBorder: "#C3E1E1",
  gradeEasyBg: "#ECFDF3",
  gradeEasyBorder: "#ABEFC6",

  bgCanvas: "#F9FAFB",
  bgSurface: "#FFFFFF",
  bgOverlay: "rgba(16, 24, 40, 0.55)",

  fgPrimary: "#101828",
  fgSecondary: "#344054",
  fgTertiary: "#475467",
  fgQuaternary: "#667085",
  fgPlaceholder: "#667085",
  fgDisabled: "#98A2B3",
  fgBrand: "#319795",
  fgOnBrand: "#FFFFFF",

  borderPrimary: "#D0D5DD",
  borderSecondary: "#EAECF0",
  borderTertiary: "#F2F4F7",
  borderBrand: "#319795",

  actionPrimaryBg: "#101828",
  actionPrimaryFg: "#FFFFFF",
  actionBrandBg: "#319795",
  actionBrandFg: "#FFFFFF",
  actionSecondaryBg: "#FFFFFF",
  actionSecondaryFg: "#344054",
  actionSecondaryBorder: "#D0D5DD",
  actionTertiaryFg: "#475467",
  actionDangerBg: "#D92D20",
  actionDangerFg: "#FFFFFF",
} as const;

export const darkColors = {
  ...palette,

  gray25: "#0C111D",
  gray50: "#161B26",
  gray100: "#22262F",
  gray200: "#373A41",
  gray300: "#61656C",
  gray400: "#94969C",
  gray500: "#94969C",
  gray600: "#CECFD2",
  gray700: "#ECECED",
  gray800: "#F5F5F6",
  gray900: "#FAFAFA",

  brand25: "rgba(79, 179, 177, 0.08)",
  brand50: "rgba(79, 179, 177, 0.12)",
  brand100: "rgba(79, 179, 177, 0.18)",
  brand200: "rgba(79, 179, 177, 0.24)",
  brand300: "#7AC5C3",
  brand400: "#4FB3B1",
  brand500: "#319795",
  brand600: "#4FB3B1",
  brand700: "#7AC5C3",
  brand800: "#C3E1E1",
  brand900: "#D2EEEE",

  orange25: "rgba(243, 135, 68, 0.08)",
  orange50: "rgba(243, 135, 68, 0.14)",
  orange100: "rgba(253, 176, 34, 0.18)",
  orange200: "rgba(253, 176, 34, 0.24)",
  orange700: "#F38744",

  gradeAgainBg: "rgba(249, 112, 102, 0.12)",
  gradeAgainBorder: "rgba(249, 112, 102, 0.24)",
  gradeHardBg: "rgba(214, 187, 251, 0.12)",
  gradeHardBorder: "rgba(214, 187, 251, 0.24)",
  gradeGoodBg: "rgba(79, 179, 177, 0.12)",
  gradeGoodBorder: "rgba(79, 179, 177, 0.24)",
  gradeEasyBg: "rgba(71, 205, 137, 0.12)",
  gradeEasyBorder: "rgba(71, 205, 137, 0.24)",

  bgCanvas: "#0C111D",
  bgSurface: "#161B26",
  bgOverlay: "rgba(0, 0, 0, 0.65)",

  fgPrimary: "#F5F5F6",
  fgSecondary: "#CECFD2",
  fgTertiary: "#94969C",
  fgQuaternary: "#717680",
  fgPlaceholder: "#717680",
  fgDisabled: "#61656C",
  fgBrand: "#4FB3B1",
  fgOnBrand: "#FFFFFF",

  borderPrimary: "#373A41",
  borderSecondary: "#22262F",
  borderTertiary: "#161B26",
  borderBrand: "#4FB3B1",

  actionPrimaryBg: "#F5F5F6",
  actionPrimaryFg: "#101828",
  actionBrandBg: "#319795",
  actionBrandFg: "#FFFFFF",
  actionSecondaryBg: "#161B26",
  actionSecondaryFg: "#CECFD2",
  actionSecondaryBorder: "#373A41",
  actionTertiaryFg: "#94969C",
  actionDangerBg: "#F97066",
  actionDangerFg: "#101828",
} as const;

export type ThemeColors = { [K in keyof typeof lightColors]: string };

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
  lg: 8,
  xl: 10,
  xl2: 12,
  xl3: 16,
  xl4: 20,
  pill: 9999,
} as const;

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
  shadowColor: "#101828",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 2,
  elevation: 1,
} as const;

const shadowSmLight = {
  shadowColor: "#101828",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.08,
  shadowRadius: 3,
  elevation: 2,
} as const;

const shadowMdLight = {
  shadowColor: "#101828",
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.08,
  shadowRadius: 8,
  elevation: 4,
} as const;

const shadowLgLight = {
  shadowColor: "#101828",
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.1,
  shadowRadius: 16,
  elevation: 8,
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
    error: lightColors.gradeAgain,
    success: lightColors.gradeEasy,
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
