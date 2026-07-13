"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const NEW_DECK_MENU_ID = "app-new-deck-menu";

type MenuItem = {
  id: string;
  icon: string;
  label: string;
  description: string;
  href?: string;
  onClick?: () => void;
};

type Props = {
  size?: "default" | "sm";
  buttonLabel?: string;
  showButtonIcon?: boolean;
  /** When set, "Import a deck" opens this callback instead of navigating away. */
  onImport?: () => void;
};

function buildItems(onImport?: () => void): MenuItem[] {
  return [
    {
      id: "generate",
      href: "/create",
      icon: "ri-sparkling-2-line",
      label: "Generate",
      description: "From text, documents, or video",
    },
    {
      id: "import",
      href: onImport ? undefined : "/create?import=anki",
      onClick: onImport,
      icon: "ri-folder-download-line",
      label: "Import",
      description: "Upload an Anki .apkg file",
    },
    {
      id: "community",
      href: "/community",
      icon: "ri-community-line",
      label: "Subscribe",
      description: "Browse decks shared by others",
    },
  ];
}

export function NewDeckMenu({
  size = "default",
  buttonLabel = "New deck",
  showButtonIcon = true,
  onImport,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const items = buildItems(onImport);

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
        {showButtonIcon ? <i className="ri-add-line" aria-hidden /> : null}
        {buttonLabel}
        <i className={open ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} />
      </button>

      {open ? (
        <div id={NEW_DECK_MENU_ID} role="menu" aria-label="New deck options" style={s.panel}>
          {items.map((item) => {
            const inner = (
              <>
                <span style={s.itemIcon} aria-hidden>
                  <i className={item.icon} />
                </span>
                <span style={s.itemCopy}>
                  <span style={s.itemLabel}>{item.label}</span>
                  <span style={s.itemDescription}>{item.description}</span>
                </span>
                <i className="ri-arrow-right-s-line" style={s.itemArrow} aria-hidden />
              </>
            );

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  className="new-deck-menu__item"
                  style={s.item}
                  onClick={() => setOpen(false)}
                >
                  {inner}
                </Link>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="new-deck-menu__item"
                style={s.itemButton}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {inner}
              </button>
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
    display: "inline-flex",
  },
  panel: {
    position: "absolute",
    top: "calc(100% + 8px)",
    right: 0,
    zIndex: 40,
    // Wide enough that every description stays on one line so rows match.
    minWidth: 304,
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    boxSizing: "border-box",
    minHeight: 56,
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    color: "inherit",
    textDecoration: "none",
    transition: "background 0.15s ease",
  },
  itemButton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    boxSizing: "border-box",
    minHeight: 56,
    padding: "10px 12px",
    borderRadius: "var(--radius-md)",
    border: "none",
    background: "transparent",
    color: "inherit",
    font: "inherit",
    textAlign: "left",
    cursor: "pointer",
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
    whiteSpace: "nowrap",
  },
  itemArrow: {
    color: "var(--fg-quaternary)",
    fontSize: 16,
    flexShrink: 0,
  },
};
