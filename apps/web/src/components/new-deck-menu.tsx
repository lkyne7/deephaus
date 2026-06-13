"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const NEW_DECK_MENU_ID = "app-new-deck-menu";

const ITEMS = [
  {
    href: "/decks/new",
    icon: "ri-sparkling-2-line",
    label: "Generate a deck",
    description: "From text, documents, or video",
  },
  {
    href: "/decks/import",
    icon: "ri-folder-download-line",
    label: "Import a deck",
    description: "Upload an Anki .apkg file",
  },
  {
    href: "/community",
    icon: "ri-community-line",
    label: "Subscribe to a community deck",
    description: "Browse decks shared by others",
  },
] as const;

type Props = {
  size?: "default" | "sm";
};

export function NewDeckMenu({ size = "default" }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

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

  const buttonClass = size === "sm" ? "btn btn-primary btn-sm" : "btn btn-primary";

  return (
    <div ref={rootRef} style={s.root}>
      <button
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={NEW_DECK_MENU_ID}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-add-line" />
        New deck
        <i className={open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
      </button>

      {open ? (
        <div id={NEW_DECK_MENU_ID} role="menu" aria-label="New deck options" style={s.panel}>
          {ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              role="menuitem"
              className="new-deck-menu__item"
              style={s.item}
              onClick={() => setOpen(false)}
            >
              <span style={s.itemIcon} aria-hidden>
                <i className={item.icon} />
              </span>
              <span style={s.itemCopy}>
                <span style={s.itemLabel}>{item.label}</span>
                <span style={s.itemDescription}>{item.description}</span>
              </span>
              <i className="ri-arrow-right-s-line" style={s.itemArrow} aria-hidden />
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    position: "relative",
    display: "inline-flex",
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    zIndex: 40,
    minWidth: 280,
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    color: "inherit",
    textDecoration: "none",
    transition: "background 0.15s ease",
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    background: "var(--bg-surface-2)",
    color: "var(--fg-secondary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    fontSize: 16,
  },
  itemCopy: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 0,
    flex: 1,
  },
  itemLabel: {
    font: "500 14px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  itemDescription: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  itemArrow: {
    color: "var(--fg-quaternary)",
    fontSize: 16,
    marginTop: 2,
    flexShrink: 0,
  },
};
