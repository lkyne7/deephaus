"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";

type AnimatedModalProps = {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  open?: boolean;
  maxWidth?: number;
};

export function AnimatedModal({ title, onClose, children, open = true, maxWidth = 560 }: AnimatedModalProps) {
  const reducedMotion = useReducedMotion();

  return (
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
              <h2 id="animated-modal-title" style={s.modalTitle}>
                {title}
              </h2>
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
    background: "var(--white)",
    borderRadius: 12,
    border: "1px solid var(--border-2)",
    boxShadow: "var(--shadow-xl)",
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
  modalTitle: {
    margin: 0,
    font: "600 18px/24px var(--font-sans)",
    color: "var(--ink-900)",
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
