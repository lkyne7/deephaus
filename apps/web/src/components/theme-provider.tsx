"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";

/**
 * Theme handling
 * ---------------------------------------------------------------------
 * `Theme` is what the user has *chosen*: `light`, `dark`, or `system`.
 * `ResolvedTheme` is the concrete value currently applied to the DOM.
 *
 * The chosen theme is persisted in `localStorage`. To avoid a flash of
 * the wrong theme on first paint, we ship a synchronous pre-hydration
 * snippet (see `themeInitScript`) that runs before React mounts and
 * sets `data-theme` on `<html>` directly.
 *
 * We deliberately *don't* use React Context here. @types/react 19 +
 * Next 15's strict JSX component contract produce a typing conflict on
 * `<Context.Provider>` that cannot be reconciled without `// @ts-ignore`
 * escape hatches. A tiny module-level store + `useSyncExternalStore`
 * gives us the same ergonomics, fewer renders, and zero JSX wrappers.
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "deephaus.theme";

interface ThemeState {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
}

function readStoredTheme(): Theme {
  if (typeof window === "undefined") return "system";
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return "system";
}

function systemPrefersDark(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function resolve(theme: Theme): ResolvedTheme {
  return theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
}

function applyToDom(theme: Theme, resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  if (theme === "system") {
    // Hand control back to the CSS @media (prefers-color-scheme) block
    // so the page stays in sync as the OS theme changes.
    document.documentElement.removeAttribute("data-theme");
  } else {
    document.documentElement.setAttribute("data-theme", resolved);
  }
}

/**
 * Tiny in-memory store. We hand-roll instead of `useState` because we
 * want a single source of truth that's shared across `<ThemeToggle>`,
 * `useTheme()`, and the OS-pref listener — without re-introducing
 * Context.
 */
const listeners = new Set<() => void>();
let initialized = false;
let state: ThemeState = {
  theme: "system",
  resolvedTheme: "light",
};

function setState(next: ThemeState) {
  state = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function getSnapshot(): ThemeState {
  return state;
}

function getServerSnapshot(): ThemeState {
  // On the server we don't know the resolved theme; the pre-hydration
  // script will set it before paint. Render in light by default.
  return { theme: "system", resolvedTheme: "light" };
}

/**
 * `ThemeProvider` is now just a one-shot initializer + OS-pref watcher.
 * It hydrates the store from `localStorage`, sets `data-theme` on
 * `<html>`, and subscribes to `prefers-color-scheme` so the resolved
 * theme tracks OS changes whenever the user is on `system`. Mount it
 * once near the root of the app.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Synchronous client-side init so the first render of children sees
  // the right theme. Safe during render: idempotent + only mutates
  // module-level state before any consumer has subscribed.
  if (typeof window !== "undefined" && !initialized) {
    initialized = true;
    const stored = readStoredTheme();
    const resolved = resolve(stored);
    state = { theme: stored, resolvedTheme: resolved };
    applyToDom(stored, resolved);
  }

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (state.theme !== "system") return;
      const resolved: ResolvedTheme = mql.matches ? "dark" : "light";
      if (resolved !== state.resolvedTheme) {
        setState({ theme: "system", resolvedTheme: resolved });
      }
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return children;
}

/**
 * Subscribe to OS theme changes once per mount. Re-evaluating
 * `resolvedTheme` whenever the user is on `system` and the OS flips.
 * Returns the current state.
 */
export function useTheme(): {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
} {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((next: Theme) => {
    if (typeof window !== "undefined") {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    }
    const resolved = resolve(next);
    applyToDom(next, resolved);
    setState({ theme: next, resolvedTheme: resolved });
  }, []);

  const toggleTheme = useCallback(() => {
    const current = state.resolvedTheme;
    setTheme(current === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { ...snap, setTheme, toggleTheme };
}

/**
 * Sync script — injected via `<Script strategy="beforeInteractive">` in
 * the root layout. Reads `localStorage`, falls back to the OS preference,
 * and sets `data-theme` BEFORE React hydrates so there's no flash of the
 * wrong palette. Keep this string self-contained: it runs in isolation.
 */
export const themeInitScript = `(() => {
  try {
    var stored = localStorage.getItem("${STORAGE_KEY}");
    if (stored === "light" || stored === "dark") {
      document.documentElement.setAttribute("data-theme", stored);
    }
  } catch (_) {}
})();`;

/**
 * Theme toggle button — a 32x32 icon button suitable for sidebars,
 * mobile chrome, or marketing nav. Renders a Remix Icon sun/moon based
 * on the resolved theme.
 */
export function ThemeToggle({
  size = 32,
  title = "Toggle theme",
}: {
  size?: number;
  title?: string;
}) {
  const { resolvedTheme, toggleTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={title}
      title={title}
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        background: "transparent",
        border: 0,
        color: "var(--fg-tertiary)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background 120ms ease, color 120ms ease",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-surface-2)";
        e.currentTarget.style.color = "var(--fg-primary)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--fg-tertiary)";
      }}
    >
      <i
        className={isDark ? "ri-sun-line" : "ri-moon-line"}
        style={{ fontSize: 18, lineHeight: 1 }}
      />
    </button>
  );
}
