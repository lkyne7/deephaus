"use client";

import { createPortal } from "react-dom";

/** A dismissible error at the corner of the window, for actions that failed. */
export function ErrorToast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  if (!message || typeof document === "undefined") return null;
  return createPortal(
    <div className="dh-toast dh-toast--error" role="alert">
      <span>{message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={onDismiss}
        style={{
          display: "inline-flex",
          marginLeft: "auto",
          padding: 2,
          border: "none",
          background: "transparent",
          color: "inherit",
          cursor: "pointer",
        }}
      >
        <i className="ri-close-line" aria-hidden />
      </button>
    </div>,
    document.body,
  );
}
