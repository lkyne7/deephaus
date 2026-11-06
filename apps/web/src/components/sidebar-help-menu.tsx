"use client";

import Link from "next/link";

const GITHUB_REPO = "https://github.com/lkyne7/deephaus";
const GITHUB_ISSUES = "https://github.com/lkyne7/deephaus/issues";

type HelpLink = {
  id: string;
  label: string;
  description?: string;
  icon: string;
  href: string;
  external?: boolean;
};

type ShortcutRow = {
  label: string;
  keys: string;
};

const SHORTCUT_ROWS = (searchShortcut: string, sidebarShortcut: string): ShortcutRow[] => [
  { label: "Search (or link selection)", keys: searchShortcut },
  { label: "Toggle sidebar", keys: sidebarShortcut },
  { label: "Reveal / grade (study)", keys: "Space · 1–4" },
  { label: "Undo / redo review", keys: "← · →" },
  { label: "Explain / edit / suspend", keys: "X · E · @" },
  { label: "Zoom study text", keys: "[ · ]" },
  { label: "Move in browse", keys: "↑ ↓" },
];

const HELP_LINKS: HelpLink[] = [
  {
    id: "how-it-works",
    label: "How it works",
    description: "Generate decks from any source",
    icon: "ri-magic-line",
    href: "/#how",
  },
  {
    id: "import-anki",
    label: "Import from Anki",
    description: "Upload an .apkg file",
    icon: "ri-folder-download-line",
    href: "/create/import?source=anki",
  },
  {
    id: "import-quizlet",
    label: "Import from Quizlet",
    description: "Paste or upload an export",
    icon: "ri-file-copy-2-line",
    href: "/create/import?source=quizlet",
  },
  {
    id: "community",
    label: "Community decks",
    description: "Browse shared decks",
    icon: "ri-community-line",
    href: "/community",
  },
  {
    id: "faq",
    label: "FAQ",
    description: "Common questions",
    icon: "ri-question-answer-line",
    href: "/#faq",
  },
  {
    id: "github",
    label: "GitHub",
    description: "Source code & docs",
    icon: "ri-github-line",
    href: GITHUB_REPO,
    external: true,
  },
  {
    id: "issues",
    label: "Report an issue",
    description: "Bug reports & feedback",
    icon: "ri-bug-line",
    href: GITHUB_ISSUES,
    external: true,
  },
];

/** Keyboard shortcut list shown from the account menu. */
export function ShortcutsPanel({
  searchShortcut,
  sidebarShortcut,
}: {
  searchShortcut: string;
  sidebarShortcut: string;
}) {
  return (
    <div style={s.shortcutList}>
      {SHORTCUT_ROWS(searchShortcut, sidebarShortcut).map((row) => (
        <div key={row.label} style={s.shortcutRow}>
          <span style={s.shortcutLabel}>{row.label}</span>
          <span style={s.shortcutKeys}>{row.keys}</span>
        </div>
      ))}
    </div>
  );
}

/** Help links shown from the account menu. */
export function HelpLinksPanel({ onNavigate }: { onNavigate: () => void }) {
  return (
    <>
      {HELP_LINKS.map((item) => {
        const content = (
          <>
            <i className={item.icon} style={s.itemIcon} aria-hidden />
            <span style={s.itemLabel}>{item.label}</span>
            {item.external ? (
              <i className="ri-arrow-right-up-line" style={s.itemExternal} aria-hidden />
            ) : null}
          </>
        );
        if (item.external) {
          return (
            <a
              key={item.id}
              href={item.href}
              role="menuitem"
              className="dh-menu-row"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onNavigate}
            >
              {content}
            </a>
          );
        }
        return (
          <Link
            key={item.id}
            href={item.href}
            role="menuitem"
            className="dh-menu-row"
            onClick={onNavigate}
          >
            {content}
          </Link>
        );
      })}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  shortcutList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: 4,
  },
  shortcutRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "6px 8px",
    font: "400 12.5px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  shortcutLabel: {
    minWidth: 0,
  },
  shortcutKeys: {
    font: "500 11px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
    whiteSpace: "nowrap",
    fontVariantNumeric: "tabular-nums",
  },
  itemIcon: {
    fontSize: 16,
    color: "var(--fg-quaternary)",
    flexShrink: 0,
  },
  itemLabel: {
    flex: 1,
    minWidth: 0,
  },
  itemExternal: {
    fontSize: 14,
    color: "var(--fg-quaternary)",
    flexShrink: 0,
  },
};
