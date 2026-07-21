"use client";

import { useTheme, type Theme } from "@/components/theme-provider";

const THEMES: Array<{ id: Theme; label: string; hint: string; icon: string }> = [
  { id: "light", label: "Light", hint: "Crisp white canvas", icon: "ri-sun-line" },
  { id: "dark", label: "Dark", hint: "Easy on the eyes", icon: "ri-moon-line" },
  { id: "system", label: "System", hint: "Follow your OS", icon: "ri-computer-line" },
];

export function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  return (
    <div style={s.root}>
      <p style={s.lede}>Choose how DeepHaus looks. Match your system or pick a fixed theme.</p>
      <div style={s.themeRow}>
        {THEMES.map((opt) => {
          const active = theme === opt.id;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => setTheme(opt.id)}
              style={{
                ...s.themeCard,
                border: active
                  ? "1px solid var(--brand-500)"
                  : "1px solid var(--border-secondary)",
                background: active ? "var(--brand-50)" : "var(--bg-surface)",
                color: active ? "var(--brand-800)" : "var(--fg-primary)",
              }}
            >
              <i className={opt.icon} style={s.themeIcon} aria-hidden />
              <span style={{ font: "600 14px/20px var(--font-sans)" }}>{opt.label}</span>
              <span style={s.themeHint}>{opt.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  lede: {
    margin: 0,
    font: "400 14px/21px var(--font-sans)",
    color: "var(--fg-tertiary)",
  },
  themeRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  themeCard: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 4,
    padding: "18px 20px",
    borderRadius: 8,
    cursor: "pointer",
    textAlign: "left",
    transition: "background 120ms ease, border-color 120ms ease",
  },
  themeIcon: {
    fontSize: 22,
    marginBottom: 8,
    color: "inherit",
  },
  themeHint: {
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
};
