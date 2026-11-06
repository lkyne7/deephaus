"use client";

import { useCallback, useSyncExternalStore } from "react";

export type CardFont = "serif" | "sans" | "system" | "dyslexia";

export const CARD_FONTS: Array<{ id: CardFont; label: string }> = [
  { id: "serif", label: "Serif" },
  { id: "sans", label: "Sans" },
  { id: "system", label: "System" },
  { id: "dyslexia", label: "Dyslexia friendly" },
];

export const DEFAULT_CARD_FONT: CardFont = "serif";
export const CARD_FONT_STORAGE_KEY = "deephaus.cardFont";

const CARD_FONT_VAR = "--font-card";
const DYSLEXIA_LINK_ID = "deephaus-dyslexia-font";
const DYSLEXIA_FONT_URL =
  "https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400;1,700&display=swap";

/** Serif has no entry: it is the `--font-card` default in globals.css. */
const CARD_FONT_STACKS: Partial<Record<CardFont, string>> = {
  sans: "var(--font-sans)",
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  dyslexia: '"Atkinson Hyperlegible", var(--font-sans)',
};

export function isCardFont(value: string | null): value is CardFont {
  return CARD_FONTS.some((font) => font.id === value);
}

function readStoredCardFont(): CardFont {
  if (typeof window === "undefined") return DEFAULT_CARD_FONT;
  try {
    const raw = window.localStorage.getItem(CARD_FONT_STORAGE_KEY);
    return isCardFont(raw) ? raw : DEFAULT_CARD_FONT;
  } catch {
    return DEFAULT_CARD_FONT;
  }
}

function writeStoredCardFont(font: CardFont): void {
  try {
    if (font === DEFAULT_CARD_FONT) window.localStorage.removeItem(CARD_FONT_STORAGE_KEY);
    else window.localStorage.setItem(CARD_FONT_STORAGE_KEY, font);
  } catch {
    // Ignore quota / private mode errors.
  }
}

function loadDyslexiaFont(): void {
  if (document.getElementById(DYSLEXIA_LINK_ID)) return;
  const link = document.createElement("link");
  link.id = DYSLEXIA_LINK_ID;
  link.rel = "stylesheet";
  link.href = DYSLEXIA_FONT_URL;
  document.head.appendChild(link);
}

function applyCardFont(font: CardFont): void {
  const stack = CARD_FONT_STACKS[font];
  const root = document.documentElement;
  if (stack) root.style.setProperty(CARD_FONT_VAR, stack);
  else root.style.removeProperty(CARD_FONT_VAR);
  if (font === "dyslexia") loadDyslexiaFont();
}

const listeners = new Set<() => void>();
let initialized = false;
let current: CardFont = DEFAULT_CARD_FONT;

function ensureInitialized() {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  current = readStoredCardFont();
}

function setCurrent(next: CardFont) {
  ensureInitialized();
  if (current === next) return;
  current = next;
  writeStoredCardFont(next);
  applyCardFont(next);
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  ensureInitialized();
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): CardFont {
  ensureInitialized();
  return current;
}

function getServerSnapshot(): CardFont {
  return DEFAULT_CARD_FONT;
}

export function useCardFont(): { cardFont: CardFont; setCardFont: (font: CardFont) => void } {
  const cardFont = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setCardFont = useCallback((next: CardFont) => setCurrent(next), []);
  return { cardFont, setCardFont };
}

/** Runs before paint, like the theme script. Keep it self-contained. */
export const cardFontInitScript = `(() => {
  try {
    var stacks = ${JSON.stringify(CARD_FONT_STACKS)};
    var font = localStorage.getItem("${CARD_FONT_STORAGE_KEY}");
    if (!font || !stacks[font]) return;
    document.documentElement.style.setProperty("${CARD_FONT_VAR}", stacks[font]);
    if (font === "dyslexia") {
      var link = document.createElement("link");
      link.id = "${DYSLEXIA_LINK_ID}";
      link.rel = "stylesheet";
      link.href = "${DYSLEXIA_FONT_URL}";
      document.head.appendChild(link);
    }
  } catch (_) {}
})();`;
