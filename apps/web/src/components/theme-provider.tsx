"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

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
 */
export type Theme = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "deephaus.theme";

interface ThemeContextValue {
  /** What the user picked (may be `"system"`). */
  theme: Theme;
  /** The resolved value currently on `<html data-theme="...">`. */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

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

function applyTheme(theme: Theme): ResolvedTheme {
  const resolved: ResolvedTheme = theme === "system" ? (systemPrefersDark() ? "dark" : "light") : theme;
  if (typeof document !== "undefined") {
    if (theme === "system") {
      // Let the CSS @media query decide so the surface stays in sync with
      // the OS as the user toggles it; we still expose the resolved value
      // via context for components that need to branch on it.
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", resolved);
    }
  }
  return resolved;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (typeof document !== "undefined") {
      const attr = document.documentElement.getAttribute("data-theme");
      if (attr === "light" || attr === "dark") return attr;
    }
    return systemPrefersDark() ? "dark" : "light";
  });

  // React to OS theme changes when the user is on `system`.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") setResolvedTheme(mql.matches ? "dark" : "light");
    };
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      if (next === "system") window.localStorage.removeItem(STORAGE_KEY);
      else window.localStorage.setItem(STORAGE_KEY, next);
    }
    setResolvedTheme(applyTheme(next));
  }, []);

  const toggleTheme = useCallback(() => {
    // The toggle button cycles light → dark → light explicitly; we
    // intentionally don't drop into `system` from the toggle because
    // most users expect a single, predictable swap. (Set system via API.)
    const current = resolvedTheme;
    setTheme(current === "dark" ? "light" : "dark");
  }, [resolvedTheme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, toggleTheme }),
    [theme, resolvedTheme, setTheme, toggleTheme],
  );

  // Use `createElement` instead of JSX for the Provider. Both the legacy
  // `<ThemeContext.Provider>` and the React-19 `<ThemeContext>` shorthand
  // trip Next 15's strict JSX type check on Vercel — the @types/react 19
  // `ProviderExoticComponent` return type (`ReactNode`) is too narrow for
  // Next's `ReactNode | Promise<ReactNode>` JSX contract. `createElement`
  // bypasses that JSX-element check entirely and matches at runtime.
  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used inside <ThemeProvider>");
  }
  return ctx;
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
