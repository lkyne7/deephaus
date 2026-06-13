"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const TOPBAR_MENU_ID = "app-topbar-more-menu";

export type TopbarMenuItem = {
  id: string;
  label: string;
  icon: string;
  href?: string;
  onClick?: () => void;
  danger?: boolean;
};

type Props = {
  items: TopbarMenuItem[];
};

/** 3-dots overflow menu in the topbar with per-page items. */
export function TopbarMoreMenu({ items }: Props) {
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

  if (!items.length) return null;

  return (
    <div ref={rootRef} style={s.root}>
      <button
        type="button"
        className="notion-topbar-icon-btn"
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={TOPBAR_MENU_ID}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-more-line" aria-hidden />
      </button>

      {open ? (
        <div id={TOPBAR_MENU_ID} role="menu" aria-label="Page actions" style={s.panel}>
          {items.map((item) => {
            const content = (
              <>
                <i
                  className={item.icon}
                  style={{
                    ...s.itemIcon,
                    color: item.danger ? "var(--grade-again)" : undefined,
                  }}
                  aria-hidden
                />
                <span
                  style={{
                    ...s.itemLabel,
                    color: item.danger ? "var(--grade-again)" : undefined,
                  }}
                >
                  {item.label}
                </span>
              </>
            );

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  className="topbar-menu__item"
                  style={s.item}
                  onClick={() => setOpen(false)}
                >
                  {content}
                </Link>
              );
            }

            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                className="topbar-menu__item"
                style={{ ...s.item, width: "100%", background: "none", border: "none", cursor: "pointer" }}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                {content}
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
    minWidth: 220,
    padding: 6,
    borderRadius: "var(--radius-lg)",
    border: "1px solid var(--border-secondary)",
    background: "var(--bg-surface)",
    boxShadow: "var(--shadow-lg)",
    display: "flex",
    flexDirection: "column",
  },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: "var(--radius-md)",
    color: "inherit",
    textDecoration: "none",
    textAlign: "left",
    transition: "background 0.15s ease",
  },
  itemIcon: {
    fontSize: 16,
    color: "var(--fg-secondary)",
    flexShrink: 0,
    width: 18,
    textAlign: "center",
  },
  itemLabel: {
    font: "400 13.5px/20px var(--font-sans)",
    color: "var(--fg-primary)",
    whiteSpace: "nowrap",
  },
};
