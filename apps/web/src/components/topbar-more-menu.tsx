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
    <div ref={rootRef} className="dh-topbar-menu">
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
        <div id={TOPBAR_MENU_ID} role="menu" aria-label="Page actions" className="dh-menu-panel">
          {items.map((item) => {
            const className = `dh-menu-row${item.danger ? " dh-menu-row--danger" : ""}`;
            const content = (
              <>
                <i className={item.icon} aria-hidden />
                {item.label}
              </>
            );

            if (item.href) {
              return (
                <Link
                  key={item.id}
                  href={item.href}
                  role="menuitem"
                  className={className}
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
                className={className}
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
