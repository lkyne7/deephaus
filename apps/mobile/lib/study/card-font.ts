import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";
import { Platform, type TextStyle } from "react-native";
import { serifFont } from "@/lib/fonts";

export type CardFont = "serif" | "sans" | "system";

export const CARD_FONT_OPTIONS: readonly { value: CardFont; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
  { value: "system", label: "System" },
];

const STORAGE_KEY = "deephaus:card-font";

let current: CardFont = "serif";
let hydrated = false;
const listeners = new Set<() => void>();

function publish(next: CardFont) {
  current = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!hydrated) {
    hydrated = true;
    void AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (stored === "serif" || stored === "sans" || stored === "system") publish(stored);
      })
      .catch(() => undefined);
  }
  return () => {
    listeners.delete(listener);
  };
}

export function useCardFont(): CardFont {
  return useSyncExternalStore(subscribe, () => current);
}

export function setCardFont(next: CardFont) {
  publish(next);
  void AsyncStorage.setItem(STORAGE_KEY, next).catch(() => undefined);
}

/** Family for card text. System is the device font; Sans is a neutral grotesque on iOS. */
export function cardFontStyle(font: CardFont): TextStyle {
  if (font === "serif") return serifFont();
  if (font === "sans" && Platform.OS === "ios") return { fontFamily: "Helvetica Neue" };
  return {};
}
