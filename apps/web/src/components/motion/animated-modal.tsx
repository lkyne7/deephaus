"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";

type AnimatedModalProps = {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  open?: boolean;
  maxWidth?: number;
  /** Close on Escape, matching the menus around it. */
  closeOnEscape?: boolean;
};

export function AnimatedModal({
  title,
  subtitle,
  onClose,
  children,
  open = true,
  maxWidth = 560,
  closeOnEscape = false,
}: AnimatedModalProps) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  const overlay = (
    <AnimatePresence mode="wait">
      {open && (
        <m.div
          key="modal-overlay"
          style={s.overlay}
          onClick={onClose}
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition(motionTokens.duration.fast, undefined, reducedMotion ?? false)}
        >
          <m.div
            style={{ ...s.modal, maxWidth }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="animated-modal-title"
            variants={scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={motionTransition(undefined, undefined, reducedMotion ?? false)}
          >
            <div style={s.modalHeader}>
              <div style={s.modalHeading}>
                <h2
                  id="animated-modal-title"
                  style={subtitle ? { ...s.modalTitle, ...s.modalTitleLarge } : s.modalTitle}
                >
                  {title}
                </h2>
                {subtitle ? <p style={s.modalSubtitle}>{subtitle}</p> : null}
              </div>
              <button type="button" onClick={onClose} style={s.closeBtn} aria-label="Close">
                <i className="ri-close-line" />
              </button>
            </div>
            {children}
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );

  // Render into <body> so the overlay escapes `.dh-app-main`'s stacking
  // context and can cover and center within the full viewport.
  if (!mounted) return null;
  return createPortal(overlay, document.body);
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    background: "var(--bg-overlay)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    zIndex: 100,
  },
  modal: {
    background: "var(--bg-surface)",
    borderRadius: 18,
    border: "1px solid var(--border-secondary)",
    boxShadow: "var(--shadow-lg)",
    width: "100%",
    maxWidth: 560,
    maxHeight: "85vh",
    overflow: "auto",
    padding: 24,
  },
  modalHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 16,
  },
  modalHeading: {
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  modalTitle: {
    margin: 0,
    font: "400 23px/30px var(--font-serif)",
    color: "var(--fg-primary)",
  },
  modalTitleLarge: {
    font: "400 26px/32px var(--font-serif)",
    letterSpacing: "-0.01em",
  },
  modalSubtitle: {
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  closeBtn: {
    border: 0,
    background: "transparent",
    fontSize: 20,
    color: "var(--fg-4)",
    cursor: "pointer",
    padding: 4,
  },
};
