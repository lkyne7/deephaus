/**
 * DeepHaus design tokens, shared by the web and mobile apps.
 *
 * Web mirrors these as CSS variables in `apps/web/src/app/globals.css`; a test
 * in the web app fails if the two drift. Mobile reads them directly.
 */

const lightGray = {
  25: "#FCFBF8",
  50: "#F7F5F0",
  100: "#F3F1EA",
  200: "#E7E4DB",
  300: "#D6D2C7",
  400: "#A9A59A",
  500: "#716E65",
  600: "#55534B",
  700: "#3F3D37",
  800: "#2B2A26",
  900: "#1F1E1B",
} as const;

/** Flipped so 900 stays the strongest ink in both themes. */
const darkGray = {
  25: "#1E1D1B",
  50: "#262523",
  100: "#302F2C",
  200: "#3D3B37",
  300: "#4F4D47",
  400: "#75726A",
  500: "#9D9A90",
  600: "#C6C3B9",
  700: "#E2DFD6",
  800: "#ECEAE2",
  900: "#F3F1EA",
} as const;

export const designColors = {
  light: {
    gray: lightGray,
    canvas: "#FAF9F5",
    rail: "#F3F1EA",
    surface: "#FFFFFF",
    sunken: "#F3F1EA",
    hover: "rgba(46, 40, 28, 0.055)",
    active: "rgba(46, 40, 28, 0.09)",
    line: "rgba(46, 40, 28, 0.12)",
    lineStrong: "rgba(46, 40, 28, 0.22)",
    ink: "#1F1E1B",
    ink2: "#55534B",
    ink3: "#716E65",
    onInk: "#FAF9F5",
    accent: "#2C7A7B",
    accentHover: "#236566",
    accentInk: "#1F6768",
    accentSoft: "rgba(44, 122, 123, 0.11)",
    onAccent: "#FFFFFF",
    due: "#A8571F",
    dueDot: "#C9702E",
    dueSoft: "rgba(201, 112, 46, 0.12)",
    danger: "#B3402A",
    dangerSoft: "rgba(179, 64, 42, 0.09)",
    success: "#2F7A52",
    scrim: "rgba(38, 34, 26, 0.34)",
    /** Again to Easy: an ordered two-hue scale, always shown with a label. */
    grade: { again: "#B8452C", hard: "#DE9A80", good: "#5DB3AF", easy: "#1F7A78" },
    heat: ["rgba(46, 40, 28, 0.06)", "#CDE6E3", "#94CBC7", "#4FA5A2", "#1F7A78"],
    projected: ["#F6E3C2", "#EDC88A", "#DFA24E", "#C9702E"],
  },
  dark: {
    gray: darkGray,
    canvas: "#262523",
    rail: "#1E1D1B",
    surface: "#302F2C",
    sunken: "#1E1D1B",
    hover: "rgba(240, 235, 220, 0.065)",
    active: "rgba(240, 235, 220, 0.11)",
    line: "rgba(240, 235, 220, 0.12)",
    lineStrong: "rgba(240, 235, 220, 0.24)",
    ink: "#F3F1EA",
    ink2: "#C6C3B9",
    ink3: "#9D9A90",
    onInk: "#1F1E1B",
    accent: "#4FB3AE",
    accentHover: "#6CC6C1",
    accentInk: "#7AD0CB",
    accentSoft: "rgba(79, 179, 174, 0.15)",
    onAccent: "#10211F",
    due: "#E6A36C",
    dueDot: "#D98A4A",
    dueSoft: "rgba(217, 138, 74, 0.16)",
    danger: "#EC8B73",
    dangerSoft: "rgba(236, 139, 115, 0.12)",
    success: "#7CC49B",
    scrim: "rgba(10, 9, 8, 0.55)",
    grade: { again: "#E0683F", hard: "#A8644C", good: "#3F8F8C", easy: "#6FD0CB" },
    heat: ["rgba(240, 235, 220, 0.07)", "#2B4A48", "#2F6E6B", "#3F9C98", "#7AD0CB"],
    projected: ["#4A3B24", "#6E5429", "#A67A33", "#D98A4A"],
  },
} as const;

export type DesignColorScheme = keyof typeof designColors;

export const designRadius = {
  control: 9,
  input: 10,
  card: 16,
  sheet: 20,
  pill: 9999,
} as const;
