import { loadAsync } from "expo-font";
import { Platform, type TextStyle } from "react-native";
import { Newsreader_400Regular } from "@expo-google-fonts/newsreader/400Regular";
import { Newsreader_400Regular_Italic } from "@expo-google-fonts/newsreader/400Regular_Italic";
import { Newsreader_500Medium } from "@expo-google-fonts/newsreader/500Medium";
import { Newsreader_500Medium_Italic } from "@expo-google-fonts/newsreader/500Medium_Italic";
import { Newsreader_600SemiBold } from "@expo-google-fonts/newsreader/600SemiBold";
import { Newsreader_600SemiBold_Italic } from "@expo-google-fonts/newsreader/600SemiBold_Italic";
import { Quicksand_700Bold } from "@expo-google-fonts/quicksand/700Bold";

export type SerifWeight = 400 | 500 | 600;

const FONT_ASSETS = {
  Quicksand_700Bold,
  Newsreader_400Regular,
  Newsreader_400Regular_Italic,
  Newsreader_500Medium,
  Newsreader_500Medium_Italic,
  Newsreader_600SemiBold,
  Newsreader_600SemiBold_Italic,
};

/** Each Newsreader cut is its own family; `fontWeight` doesn't select one. */
const FAMILIES: Record<SerifWeight, { normal: string; italic: string }> = {
  400: { normal: "Newsreader_400Regular", italic: "Newsreader_400Regular_Italic" },
  500: { normal: "Newsreader_500Medium", italic: "Newsreader_500Medium_Italic" },
  600: { normal: "Newsreader_600SemiBold", italic: "Newsreader_600SemiBold_Italic" },
};

const SYSTEM_SERIF = Platform.select({ ios: "ui-serif", default: "serif" });
const SYSTEM_ROUNDED = Platform.select({ ios: "ui-rounded", default: "sans-serif-medium" });
const LOAD_TIMEOUT_MS = 2500;

let newsreaderLoaded = false;

/**
 * Loads Newsreader, settling after a short timeout so a failed or slow load
 * never holds the app on the splash. Until it resolves `serifFont` returns the
 * system serif, so the first render after a timeout still reads as serif.
 */
export async function loadAppFonts() {
  const load = loadAsync(FONT_ASSETS).then(
    () => {
      newsreaderLoaded = true;
    },
    (error: unknown) => {
      console.warn("Newsreader failed to load; using the system serif", error);
    },
  );
  await Promise.race([
    load,
    new Promise((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS)),
  ]);
}

/**
 * Serif text style. Call it while rendering (not in a module-level
 * StyleSheet), because the family depends on whether the font has loaded.
 */
export function serifFont(weight: SerifWeight = 400, italic = false): TextStyle {
  if (newsreaderLoaded) {
    return {
      fontFamily: FAMILIES[weight][italic ? "italic" : "normal"],
      fontWeight: "normal",
      fontStyle: "normal",
    };
  }
  return {
    fontFamily: SYSTEM_SERIF,
    fontWeight: String(weight) as TextStyle["fontWeight"],
    fontStyle: italic ? "italic" : "normal",
  };
}

/** Bold or medium run inside text that may be set in the serif. */
export function emphasisFont(
  fontFamily: string | undefined,
  weight: 500 | 600,
): TextStyle {
  const isSerif = fontFamily === SYSTEM_SERIF || fontFamily?.startsWith("Newsreader");
  return isSerif ? serifFont(weight) : { fontWeight: String(weight) as TextStyle["fontWeight"] };
}

/**
 * The DeepHaus wordmark face: Quicksand 700, as on web (`.dh-wordmark`).
 * Falls back to the rounded system face until the font has loaded.
 */
export function brandFont(): TextStyle {
  if (newsreaderLoaded) {
    return { fontFamily: "Quicksand_700Bold", fontWeight: "normal" };
  }
  return { fontFamily: SYSTEM_ROUNDED, fontWeight: "700" };
}
