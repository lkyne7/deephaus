"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

export type MenuLink = { href: string; label: string; current?: boolean };

/** Phone-width menu for the marketing nav; hidden on wider screens, where the links sit inline. */
export function MarketingMenu({ links, signIn }: { links: MenuLink[]; signIn: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div className="lp-menu" ref={rootRef}>
      <button
        type="button"
        className="lp-menu-button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((value) => !value)}
      >
        <i className={open ? "ri-close-line" : "ri-menu-line"} aria-hidden />
      </button>
      <div id={panelId} className="lp-menu-panel" hidden={!open}>
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="lp-menu-link"
            aria-current={link.current ? "page" : undefined}
            onClick={close}
          >
            {link.label}
          </Link>
        ))}
        {signIn && (
          <Link href="/login" className="lp-menu-link lp-menu-link--secondary" onClick={close}>
            Sign in
          </Link>
        )}
      </div>
    </div>
  );
}
