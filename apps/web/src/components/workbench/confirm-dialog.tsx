"use client";

import type { ReactNode } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";

type Props = {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  /** Style the confirm button as destructive. */
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** A small "are you sure" dialog, used where the browser's confirm() was. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = false,
  busy = false,
  error,
  onConfirm,
  onCancel,
}: Props) {
  if (!open) return null;
  return (
    <AnimatedModal title={title} onClose={busy ? () => undefined : onCancel} maxWidth={440} closeOnEscape>
      <div style={s.body}>
        <div style={s.text}>{children}</div>
        {error ? (
          <div style={s.error} role="alert">
            {error}
          </div>
        ) : null}
        <div style={s.footer}>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={onConfirm}
            disabled={busy}
            autoFocus
          >
            {busy ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: { display: "flex", flexDirection: "column", gap: 14 },
  text: { font: "400 13.5px/20px var(--font-sans)", color: "var(--fg-quaternary)" },
  error: { font: "400 13px/18px var(--font-sans)", color: "var(--danger)" },
  footer: { display: "flex", justifyContent: "flex-end", gap: 8 },
};
