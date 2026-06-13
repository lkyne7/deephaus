"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatShortcut } from "@/lib/keyboard-shortcuts";

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

type Props = {
  collapsed: boolean;
  modKey: string;
  searchShortcut: string;
  sidebarShortcut: string;
};

function HelpHoverLabel({ collapsed, label }: { collapsed: boolean; label: string }) {
  if (!collapsed) return null;
  return (
    <span className="notion-sidebar-hover-label" role="tooltip" aria-hidden>
      <span className="notion-sidebar-hover-label-text">{label}</span>
    </span>
  );
}

const HELP_MENU_ID = "app-sidebar-help-menu";

/** Help popover in the sidebar — shortcuts plus useful links. */
export function SidebarHelpMenu({ collapsed, modKey, searchShortcut, sidebarShortcut }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const shortcuts = useMemo<ShortcutRow[]>(
    () => [
      { label: "Search cards", keys: searchShortcut },
      { label: "Toggle sidebar", keys: sidebarShortcut },
      { label: "Reveal / grade (study)", keys: "Space · 1–4" },
      { label: "Undo / redo review", keys: `${formatShortcut(modKey, "Z")} · ${formatShortcut(modKey, "⇧Z")}` },
      { label: "Move in browse", keys: "↑ ↓" },
    ],
    [modKey, searchShortcut, sidebarShortcut],
  );

  const links = useMemo<HelpLink[]>(
    () => [
      {
        id: "how-it-works",
        label: "How it works",
        description: "Generate decks from any source",
        icon: "ri-magic-line",
        href: "/#how",
      },
      {
        id: "import",
        label: "Import from Anki",
        description: "Upload an .apkg file",
        icon: "ri-folder-download-line",
        href: "/decks/import",
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
    ],
    [],
  );

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} style={s.root}>
      <button
        type="button"
        className={`notion-sidebar-item${open ? " notion-sidebar-item--active" : ""}`}
        aria-label="Help"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={HELP_MENU_ID}
        onClick={() => setOpen((value) => !value)}
      >
        <HelpHoverLabel collapsed={collapsed} label="Help" />
        <i className="ri-question-line" aria-hidden />
        <span className="notion-sidebar-item-label">Help</span>
      </button>

      {open ? (
        <div
          id={HELP_MENU_ID}
          role="menu"
          aria-label="Help"
          className="sidebar-help-menu__panel"
          style={{
            ...s.panel,
            ...(collapsed ? s.panelCollapsed : s.panelExpanded),
          }}
        >
          <div style={s.sectionHeader}>Keyboard shortcuts</div>
          <div style={s.shortcutList}>
            {shortcuts.map((row) => (
              <div key={row.label} style={s.shortcutRow}>
                <span style={s.shortcutLabel}>{row.label}</span>
                <span style={s.shortcutKeys}>{row.keys}</span>
              </div>
            ))}
          </div>

          <div style={s.divider} />

          {links.map((item) => {
            const content = (
              <>
                <span style={s.itemIcon} aria-hidden>
                  <i className={item.icon} />
                </span>
                <span style={s.itemCopy}>
                  <span style={s.itemLabel}>{item.label}</span>
                  {item.description ? (
                    <span style={s.itemDescription}>{item.description}</span>
                  ) : null}
                </span>
                {item.external ? (
                  <i className="ri-arrow-right-up-line" style={s.itemExternal} aria-hidden />
                ) : (
                  <i className="ri-arrow-right-s-line" style={s.itemExternal} aria-hidden />
                )}
              </>
            );

            if (item.external) {
              return (
                <a
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  className="sidebar-help-menu__item"
                  style={s.item}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
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
                className="sidebar-help-menu__item"
                style={s.item}
                onClick={() => setOpen(false)}
              >
                {content}
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    width: "100%",
  },
  panel: {
    position: "absolute",
    zIndex: 50,
    minWidth: 280,
    maxWidth: 320,
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
  },
  panelExpanded: {
    left: 0,
    right: 0,
    bottom: "calc(100% + 6px)",
  },
  panelCollapsed: {
    left: "calc(100% + 8px)",
    bottom: 0,
    width: 280,
  },
  sectionHeader: {
    padding: "6px 10px 4px",
    font: "600 11px/16px var(--font-sans)",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    color: "var(--fg-quaternary)",
  },
  shortcutList: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    padding: "0 4px 4px",
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
  divider: {
    height: 1,
    background: "var(--border-secondary)",
    margin: "4px 6px",
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    color: "inherit",
    textDecoration: "none",
    transition: "background 0.15s ease",
  },
  itemIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    color: "var(--fg-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 15,
  },
  itemCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    minWidth: 0,
    flex: 1,
  },
  itemLabel: {
    font: "500 13.5px/19px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  itemDescription: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  itemExternal: {
    fontSize: 14,
    color: "var(--fg-quaternary)",
    marginTop: 6,
    flexShrink: 0,
  },
};
