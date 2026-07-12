"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { motionTransition } from "@/lib/motion";

/**
 * Looping "notes in, cards out" vignette for the How-it-works section.
 * Phrases in a pasted source get highlighted one by one, and each
 * highlight materializes as a generated flashcard on the right.
 *
 * Each card slot is sized to its final card from the first frame (via a
 * hidden sizer), so the notes column stays a stable height while cards
 * appear in sequence.
 */

const CARDS = [
  {
    chipClass: "chip chip-card-basic",
    chipLabel: "Front / Back",
    q: "What triggers an action potential in a neuron?",
    a: "Depolarization past the threshold of roughly −55 mV.",
  },
  {
    chipClass: "chip chip-card-cloze",
    chipLabel: "Fill in the Blank",
    q: "Voltage-gated ___ channels open first during depolarization.",
    a: "sodium (Na⁺)",
  },
  {
    chipClass: "chip chip-card-cloze",
    chipLabel: "Fill in the Blank",
    q: "Repolarization occurs when ___ channels open.",
    a: "potassium (K⁺)",
  },
] as const;

const STEP_MS = 1500;
const HOLD_MS = 3400;

export function GenerationDemo() {
  const reducedMotion = useReducedMotion();
  // 0..CARDS.length = number of cards generated; loops back to 0.
  const [progress, setProgress] = useState(reducedMotion ? CARDS.length : 0);

  useEffect(() => {
    if (reducedMotion) {
      setProgress(CARDS.length);
      return;
    }
    const timer = setTimeout(
      () => setProgress((p) => (p >= CARDS.length ? 0 : p + 1)),
      progress >= CARDS.length ? HOLD_MS : STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [progress, reducedMotion]);

  const done = progress >= CARDS.length;

  return (
    <div className="lp-gen" aria-label="Notes being turned into flashcards">
      <div className="lp-gen-source">
        <div className="lp-gen-source-head">
          <i className="ri-file-pdf-2-line" aria-hidden />
          neuro_lecture_04.pdf
        </div>
        <p className="lp-gen-text">
          An <Hl on={progress >= 1}>action potential fires when depolarization crosses the −55 mV threshold</Hl>.{" "}
          <Hl on={progress >= 2}>Voltage-gated Na⁺ channels open first</Hl>, letting sodium rush in and spike the
          membrane potential. The cell then resets as{" "}
          <Hl on={progress >= 3}>K⁺ channels open during repolarization</Hl>, restoring the resting state before the
          next impulse.
        </p>
        <span className="lp-gen-status">
          <i className={done ? "ri-checkbox-circle-fill" : "ri-loader-4-line"} aria-hidden />
          {done ? `${CARDS.length} cards generated` : "Extracting key concepts…"}
        </span>
      </div>

      <div className="lp-gen-cards">
        {CARDS.map((card, i) => {
          const visible = progress >= i + 1;
          return (
            <div key={card.q} className="lp-gen-card-slot">
              {/* Invisible sizer locks the slot to the final card height. */}
              <div className="lp-gen-card lp-gen-card-sizer" aria-hidden>
                <span className={`${card.chipClass} lp-gen-card-type`}>{card.chipLabel}</span>
                <p className="lp-gen-card-q">{card.q}</p>
                <p className="lp-gen-card-a">{card.a}</p>
              </div>

              <AnimatePresence initial={false}>
                {visible ? (
                  <m.div
                    key="card"
                    className="lp-gen-card lp-gen-card-face"
                    initial={{ opacity: 0, y: 10, scale: 0.97 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.97 }}
                    transition={motionTransition(0.32, undefined, reducedMotion ?? false)}
                  >
                    <span className={`${card.chipClass} lp-gen-card-type`}>{card.chipLabel}</span>
                    <p className="lp-gen-card-q">{card.q}</p>
                    <p className="lp-gen-card-a">{card.a}</p>
                  </m.div>
                ) : (
                  <m.div
                    key="placeholder"
                    className="lp-gen-placeholder"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={motionTransition(0.2, undefined, reducedMotion ?? false)}
                  >
                    <i className="ri-sparkling-line" aria-hidden /> Card {i + 1}
                  </m.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Hl({ on, children }: { on: boolean; children: React.ReactNode }) {
  return <span className={`lp-gen-hl ${on ? "is-active" : ""}`}>{children}</span>;
}
