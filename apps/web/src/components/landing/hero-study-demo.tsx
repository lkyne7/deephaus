"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { motionTransition } from "@/lib/motion";

/**
 * Auto-playing (but fully interactive) study session mock for the hero.
 *
 * The loop mimics a real review: question → reveal → grade → next card.
 * It advances on its own so the hero feels alive, but any click hands
 * control to the visitor and stops the autopilot for the session.
 */

type DemoCard = {
  deck: string;
  type: "cloze" | "basic";
  chipClass: string;
  chipLabel: string;
  question: React.ReactNode;
  answer: React.ReactNode;
};

type Grade = { key: string; label: string; interval: string; className: string };

const GRADES: Grade[] = [
  { key: "again", label: "Again", interval: "<1m", className: "lp-demo-grade-again" },
  { key: "hard", label: "Hard", interval: "2d", className: "lp-demo-grade-hard" },
  { key: "good", label: "Good", interval: "4d", className: "lp-demo-grade-good" },
  { key: "easy", label: "Easy", interval: "9d", className: "lp-demo-grade-easy" },
];

function Cloze({ children, revealed }: { children: React.ReactNode; revealed: boolean }) {
  return revealed ? (
    <span className="lp-demo-cloze-answer">{children}</span>
  ) : (
    <span className="lp-demo-cloze-blank" aria-label="hidden answer">
      {children}
    </span>
  );
}

function buildCards(revealed: boolean): DemoCard[] {
  return [
    {
      deck: "Cardiology",
      type: "cloze",
      chipClass: "chip chip-card-cloze",
      chipLabel: "Fill in the Blank",
      question: (
        <>
          The heart&apos;s natural pacemaker is the <Cloze revealed={revealed}>SA node</Cloze>, located in the right
          atrium.
        </>
      ),
      answer: <>It fires 60–100 times per minute and sets the rhythm the rest of the conduction system follows.</>,
    },
    {
      deck: "World History",
      type: "basic",
      chipClass: "chip chip-card-basic",
      chipLabel: "Front / Back",
      question: <>Which treaty ended the Thirty Years&apos; War in 1648?</>,
      answer: (
        <>
          The <strong>Peace of Westphalia</strong> — it established the principle of state sovereignty that still
          shapes international law.
        </>
      ),
    },
    {
      deck: "Biochemistry",
      type: "cloze",
      chipClass: "chip chip-card-cloze",
      chipLabel: "Fill in the Blank",
      question: (
        <>
          Glycolysis produces a net gain of <Cloze revealed={revealed}>2 ATP</Cloze> per glucose molecule.
        </>
      ),
      answer: <>4 ATP are generated, but 2 are spent in the investment phase — the payoff phase nets the rest.</>,
    },
    {
      deck: "Spanish Vocab",
      type: "basic",
      chipClass: "chip chip-card-basic",
      chipLabel: "Front / Back",
      question: <>¿Qué significa &ldquo;aprovechar&rdquo;?</>,
      answer: (
        <>
          <strong>To take advantage of / make the most of.</strong> &ldquo;Aprovecha el tiempo&rdquo; — make the most
          of your time.
        </>
      ),
    },
  ];
}

const REVEAL_MS = 2600;
const GRADE_FLASH_MS = 2100;
const NEXT_MS = 550;
// Which grade the autopilot "presses" per card, for variety.
const AUTO_GRADES = [2, 3, 2, 1];

export function HeroStudyDemo() {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [flashing, setFlashing] = useState<string | null>(null);
  const [autopilot, setAutopilot] = useState(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const cards = buildCards(revealed);
  const card = cards[index % cards.length];

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);

  const schedule = useCallback((fn: () => void, ms: number) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);

  const advance = useCallback(() => {
    setFlashing(null);
    setRevealed(false);
    setIndex((i) => (i + 1) % 4);
  }, []);

  // Autopilot loop: reveal → flash a grade → advance.
  useEffect(() => {
    if (!autopilot || reducedMotion) return;
    clearTimers();
    if (!revealed) {
      schedule(() => setRevealed(true), REVEAL_MS);
    } else {
      schedule(() => setFlashing(GRADES[AUTO_GRADES[index % AUTO_GRADES.length]].key), GRADE_FLASH_MS);
      schedule(advance, GRADE_FLASH_MS + NEXT_MS);
    }
    return clearTimers;
  }, [autopilot, revealed, index, reducedMotion, clearTimers, schedule, advance]);

  const takeControl = useCallback(() => {
    setAutopilot(false);
    clearTimers();
  }, [clearTimers]);

  const handleCardClick = () => {
    takeControl();
    if (!revealed) setRevealed(true);
  };

  const handleGrade = (key: string) => {
    takeControl();
    setFlashing(key);
    timers.current.push(setTimeout(advance, 320));
  };

  return (
    <div className="lp-demo" aria-label="Interactive study session preview">
      <div className="lp-demo-halo" aria-hidden />
      <div className="lp-demo-shell">
        <div className="lp-demo-topbar">
          <span className="lp-demo-deck">
            <i className="ri-stack-line" aria-hidden />
            {card.deck}
          </span>
          <span className="lp-demo-count">{(index % 4) + 1} of 4 due</span>
        </div>
        <div className="lp-demo-progress" aria-hidden>
          <div className="lp-demo-progress-fill" style={{ width: `${(((index % 4) + (revealed ? 1 : 0.4)) / 4) * 100}%` }} />
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <m.button
            key={index}
            type="button"
            className="lp-demo-card"
            onClick={handleCardClick}
            initial={{ opacity: 0, x: 22 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -22 }}
            transition={motionTransition(0.28, undefined, reducedMotion ?? false)}
            style={{ textAlign: "left", font: "inherit" }}
          >
            <span className={`${card.chipClass} lp-demo-card-tag`}>{card.chipLabel}</span>
            <div className="lp-demo-card-body">
              <p className="lp-demo-card-q">{card.question}</p>
              <AnimatePresence initial={false}>
                {revealed && (
                  <m.p
                    className="lp-demo-card-a"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={motionTransition(0.24, undefined, reducedMotion ?? false)}
                  >
                    {card.answer}
                  </m.p>
                )}
              </AnimatePresence>
              {!revealed && (
                <span className="lp-demo-reveal-hint">
                  <i className="ri-cursor-line" aria-hidden /> Tap to reveal
                </span>
              )}
            </div>
          </m.button>
        </AnimatePresence>

        <div className="lp-demo-grades" role="group" aria-label="Grade this card">
          {GRADES.map((g) => (
            <button
              key={g.key}
              type="button"
              disabled={!revealed}
              onClick={() => handleGrade(g.key)}
              className={`lp-demo-grade ${g.className} ${flashing === g.key ? "is-flashing" : ""}`}
            >
              <span className="lp-demo-grade-label">{g.label}</span>
              <span className="lp-demo-grade-interval">{g.interval}</span>
            </button>
          ))}
        </div>

        <div className="lp-demo-foot">
          <i className="ri-sparkling-2-line" aria-hidden />
          Every rating reshapes tomorrow&apos;s queue
        </div>
      </div>
    </div>
  );
}
