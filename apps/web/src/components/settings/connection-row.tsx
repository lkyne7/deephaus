"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** One Sources row on the Connections tab. */
export function ConnectionRow({
  icon,
  name,
  detail,
  children,
}: {
  icon: string;
  name: string;
  detail: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="dhs-row">
      <span className="dhs-logo" aria-hidden>
        <i className={icon} />
      </span>
      <div className="dhs-row__main">
        <div className="dhs-row__title">{name}</div>
        <div className="dhs-muted">{detail}</div>
      </div>
      {children}
    </div>
  );
}

export function ConnectedPill() {
  return (
    <span className="dh-pill dh-pill--accent">
      <i className="ri-check-line" aria-hidden />
      Connected
    </span>
  );
}

export type ConnectionMenuItem = {
  label: string;
  icon: string;
  danger?: boolean;
  onSelect: () => void;
};

export function ConnectionMenu({
  label,
  busy,
  items,
}: {
  label: string;
  busy: boolean;
  items: ConnectionMenuItem[];
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="dhs-menu-root">
      <button
        type="button"
        className="dhs-icon-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
      >
        <i className={busy ? "ri-loader-4-line icon-spin" : "ri-more-line"} aria-hidden />
      </button>
      {open ? (
        <div role="menu" aria-label={label} className="dh-menu-panel dhs-menu-panel">
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              className={`dh-menu-row${item.danger ? " dh-menu-row--danger" : ""}`}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              <i className={item.icon} aria-hidden />
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ConnectionBanner({
  kind,
  message,
  onDismiss,
}: {
  kind: "ok" | "error";
  message: string;
  onDismiss: () => void;
}) {
  return (
    <div className={`dhs-banner${kind === "error" ? " dhs-banner--error" : ""}`} role="status">
      <span>{message}</span>
      <button type="button" className="dhs-icon-btn" onClick={onDismiss} aria-label="Dismiss">
        <i className="ri-close-line" aria-hidden />
      </button>
    </div>
  );
}
