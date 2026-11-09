"use client";

import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { isDesktopApp } from "@deephaus/shared";
import { BrandMark } from "@/components/brand-mark";
import { CardStackIllustration } from "@/components/onboarding/card-stack-illustration";
import { OnboardingCardContent } from "@/components/onboarding/onboarding-card-content";
import {
  ONBOARDING_REVIEW_GRADES,
  onboardingGradeFromKey,
  onboardingGradeShortcut,
  type OnboardingReviewGradeLabel,
} from "@/components/onboarding/onboarding-shortcuts";
import { ThemeToggle } from "@/components/theme-provider";
import { DOWNLOAD_PAGE, IOS_APP } from "@/lib/apps";
import { isTypingTarget } from "@/lib/keyboard-shortcuts";
import { motionTransition, motionTokens } from "@/lib/motion";
import {
  teardownPowerSync,
  waitForPowerSyncUploads,
} from "@/lib/offline/db";
import { isOnboardingCompleted } from "@/lib/onboarding/metadata";
import { createClient } from "@/lib/supabase/client";
import {
  completeOnboardingAction,
  generateOnboardingDeckAction,
} from "@/lib/onboarding/actions";
import { clearReviewQueueCache } from "@/lib/study/review-cache";
import {
  DAILY_PRESETS,
  DEFAULT_ONBOARDING_PREFERENCES,
  GOAL_OPTIONS,
  ONBOARDING_OPTIONAL_STEPS,
  ONBOARDING_STEPS,
  ONBOARDING_TRACKED_STEPS,
  SAMPLE_SOURCE_TEXT,
  type OnboardingDeckResult,
  type OnboardingPreferences,
  type OnboardingStepId,
} from "@/lib/onboarding/types";
import "./onboarding.css";

const GEN_ITEMS = [
  { label: "Reading your source", threshold: 18 },
  { label: "Pulling out key concepts", threshold: 46 },
  { label: "Writing questions", threshold: 74 },
  { label: "Scheduling first reviews", threshold: 96 },
] as const;

function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function estimateCards(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 20));
}

const subscribeNever = () => () => {};

/** Where else the new deck can be studied, shown on the last onboarding screen. */
function OnboardingAppsNote() {
  const inDesktopApp = useSyncExternalStore(subscribeNever, isDesktopApp, () => false);
  const ios = IOS_APP.available ? (
    <a href={IOS_APP.href} target="_blank" rel="noreferrer">iPhone</a>
  ) : (
    "iPhone (coming soon)"
  );

  return (
    <p className="onboarding-apps-note">
      <i className="ri-refresh-line" aria-hidden />
      {inDesktopApp ? (
        <>Also syncs to the web and {ios}</>
      ) : (
        <>
          Also on{" "}
          <a href={DOWNLOAD_PAGE} target="_blank" rel="noreferrer">
            Mac, Windows and Linux
          </a>{" "}
          and {ios}
        </>
      )}
    </p>
  );
}

function progressFor(step: OnboardingStepId) {
  if (!ONBOARDING_TRACKED_STEPS.includes(step)) return null;
  const i = ONBOARDING_TRACKED_STEPS.indexOf(step) + 1;
  return { i, n: ONBOARDING_TRACKED_STEPS.length };
}

type OnboardingFlowProps = {
  initialStep?: number;
  demoDeck?: OnboardingDeckResult;
  /** Dev preview: skip persisting onboarding + avoid fake demo deck URLs. */
  previewMode?: boolean;
};

export const DEMO_ONBOARDING_DECK: OnboardingDeckResult = {
  projectId: "00000000-0000-0000-0000-000000000001",
  deckName: "Cardiology starter",
  cardCount: 12,
  firstCard: {
    id: "demo",
    type: "cloze",
    front: null,
    back: null,
    clozeText: "The body's natural pacemaker is the {{c1::SA node}}.",
  },
};

function studyHrefForDeck(deck: OnboardingDeckResult | null, previewMode: boolean): string {
  if (!deck) return "/decks";
  if (previewMode || deck.projectId === DEMO_ONBOARDING_DECK.projectId) return "/decks";
  return `/decks/${deck.projectId}/study`;
}

export function OnboardingFlow({
  initialStep = 0,
  demoDeck,
  previewMode = false,
}: OnboardingFlowProps = {}) {
  const router = useRouter();
  const [stepIndex, setStepIndex] = useState(initialStep);
  const [prefs, setPrefs] = useState<OnboardingPreferences>(DEFAULT_ONBOARDING_PREFERENCES);
  const [sourceText, setSourceText] = useState(SAMPLE_SOURCE_TEXT);
  const [genPct, setGenPct] = useState(0);
  const [genError, setGenError] = useState<string | null>(null);
  const [deck, setDeck] = useState<OnboardingDeckResult | null>(null);
  const [flipped, setFlipped] = useState(false);
  const [grade, setGrade] = useState<OnboardingReviewGradeLabel | null>(null);
  const [busy, setBusy] = useState(false);
  const reducedMotion = useReducedMotion();
  const reviewActionTransition = motionTransition(
    motionTokens.duration.fast,
    motionTokens.easeOut,
    reducedMotion ?? false,
  );

  const step = ONBOARDING_STEPS[stepIndex]!;
  const progress = progressFor(step);
  /** Generated deck, or the dev preview placeholder when jumping past generation. */
  const activeDeck = deck ?? (previewMode ? (demoDeck ?? null) : null);

  const go = useCallback((delta: number) => {
    setStepIndex((i) => Math.max(0, Math.min(ONBOARDING_STEPS.length - 1, i + delta)));
    setFlipped(false);
    setGrade(null);
  }, []);

  const runGeneration = useCallback(async () => {
    setGenPct(0);
    setGenError(null);
    setBusy(true);

    const timer = window.setInterval(() => {
      setGenPct((p) => Math.min(95, p + 5 + Math.random() * 7));
    }, 170);

    const result = await generateOnboardingDeckAction(prefs, sourceText);
    window.clearInterval(timer);

    if (result.error || !result.data) {
      setGenError(result.error ?? "Generation failed.");
      setGenPct(0);
      setBusy(false);
      return;
    }

    setGenPct(100);
    setDeck(result.data);
    setBusy(false);
    setTimeout(() => go(1), 550);
  }, [go, prefs, sourceText]);

  useEffect(() => {
    if (step !== "generating" || busy || deck || genError) return;
    void runGeneration();
  }, [step, busy, deck, genError, runGeneration]);

  function startGenerating() {
    if (!sourceText.trim()) return;
    setDeck(null);
    setGenError(null);
    go(1);
  }

  async function finish(studyHref?: string) {
    setBusy(true);
    setGenError(null);

    if (previewMode) {
      router.push(studyHref ?? studyHrefForDeck(deck, true));
      router.refresh();
      return;
    }

    try {
      const result = await completeOnboardingAction(prefs);
      if (result.error) {
        setGenError(result.error);
        setBusy(false);
        return;
      }

      const supabase = createClient();
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        setGenError("Setup was saved, but your session could not be refreshed. Please try again.");
        setBusy(false);
        return;
      }

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !isOnboardingCompleted(user)) {
        setGenError("Setup was saved, but your account has not refreshed yet. Please try again.");
        setBusy(false);
        return;
      }

      posthog.capture("onboarding_completed", {
        generated_starter_deck: deck != null,
      });

      window.location.assign(studyHref ?? studyHrefForDeck(deck, false));
    } catch {
      setGenError("Could not finish setup. Please try again.");
      setBusy(false);
    }
  }

  async function signInToDifferentAccount() {
    setBusy(true);
    setGenError(null);
    try {
      const uploadsFinished = await waitForPowerSyncUploads();
      if (
        !uploadsFinished &&
        !window.confirm(
          "Your offline changes could not finish syncing. Switch accounts anyway and discard those unsynced changes?",
        )
      ) {
        setBusy(false);
        return;
      }
      const { error } = await createClient().auth.signOut();
      if (error) {
        setGenError(error.message);
        setBusy(false);
        return;
      }
      clearReviewQueueCache();
      await teardownPowerSync();
      window.location.href = "/login";
      router.refresh();
    } catch {
      setGenError("Could not sign out. Please try again.");
      setBusy(false);
    }
  }

  const handleGrade = useCallback(
    (label: OnboardingReviewGradeLabel) => {
      if (!flipped) {
        setFlipped(true);
        return;
      }
      setGrade(label);
      setTimeout(() => go(1), 430);
    },
    [flipped, go],
  );

  useEffect(() => {
    if (step !== "firstcard") return;

    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      const isRevealKey =
        e.key === " " || e.code === "Space" || e.key === "Enter" || e.code === "Enter";

      if (isRevealKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!flipped) {
          setFlipped(true);
        } else {
          handleGrade("Good");
        }
        return;
      }

      if (flipped && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        const label = onboardingGradeFromKey(e.key);
        if (label) handleGrade(label);
      }
    }

    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [step, flipped, handleGrade]);

  const genItems = useMemo(
    () =>
      GEN_ITEMS.map(({ label, threshold }) => {
        const done = genPct >= threshold;
        const active = !done && genPct >= threshold - 28;
        return {
          label,
          state: done ? "done" : active ? "active" : "todo",
          icon: done ? "ri-checkbox-circle-fill" : active ? "ri-loader-4-line" : "ri-circle-line",
          working: active,
        };
      }),
    [genPct],
  );

  const firstCard = activeDeck?.firstCard ?? DEMO_ONBOARDING_DECK.firstCard;

  const cardCount = activeDeck?.cardCount ?? 12;
  const dueCount = cardCount;
  const newCount = cardCount;

  return (
    <div className="onboarding-root">
      <header className="onboarding-topbar">
        {stepIndex > 0 && step !== "generating" && step !== "done" ? (
          <button type="button" className="onboarding-iconbtn" onClick={() => go(-1)} aria-label="Back">
            <i className="ri-arrow-left-line" />
          </button>
        ) : (
          <span style={{ width: 32 }} />
        )}

        <BrandMark size={24} title={null} />

        <div className="dh-spacer" />

        {progress ? (
          <div className="onboarding-progress">
            <span className="label">
              Step {progress.i} of {progress.n}
            </span>
            <div className="dh-meter onboarding-progress-meter">
              <span style={{ width: `${(progress.i / progress.n) * 100}%` }} />
            </div>
          </div>
        ) : null}

        {ONBOARDING_OPTIONAL_STEPS.has(step) ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => go(1)}>
            Skip
          </button>
        ) : null}

        <ThemeToggle />
      </header>

      <div className="onboarding-screens">
        {step === "welcome" && (
          <div className="onboarding-screen">
            <div className="onboarding-col center">
              <div style={{ marginBottom: 28 }}>
                <CardStackIllustration />
              </div>
              <div style={{ marginBottom: 10 }}>
                <span className="onboarding-badge">Welcome to DeepHaus</span>
              </div>
              <h1 className="onboarding-h1 big">
                Learn more,
                <br />
                study less.
              </h1>
              <p className="onboarding-lead" style={{ maxWidth: 410 }}>
                Paste any notes, slides or textbook. DeepHaus turns them into flashcards that adapt to
                how you remember.
              </p>
              <div style={{ marginTop: 32, width: "100%", display: "flex", flexDirection: "column", gap: 12 }}>
                <button type="button" className="onboarding-btn onboarding-btn-primary" onClick={() => go(1)}>
                  Get started
                </button>
                <button
                  type="button"
                  className="onboarding-txtbtn"
                  disabled={busy}
                  onClick={() => void signInToDifferentAccount()}
                >
                  Sign in to a different account
                </button>
                {genError ? <div className="notice notice-error">{genError}</div> : null}
              </div>
            </div>
          </div>
        )}

        {step === "goal" && (
          <div className="onboarding-screen">
            <div className="onboarding-col wide">
              <h1 className="onboarding-h1">
                What brings you to DeepHaus?
              </h1>
              <p className="onboarding-lead">
                This helps shape your first deck.
              </p>
              <div className="onboarding-grid2" style={{ marginTop: 26 }}>
                {GOAL_OPTIONS.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    className="onboarding-opt-card"
                    data-selected={prefs.goal === g.id}
                    onClick={() => setPrefs((p) => ({ ...p, goal: g.id }))}
                  >
                    <i className={g.icon} />
                    <span>
                      <span className="title">{g.label}</span>
                      <span className="hint">{g.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="onboarding-btn onboarding-btn-primary"
                style={{ marginTop: 22 }}
                onClick={() => go(1)}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "daily" && (
          <div className="onboarding-screen">
            <div className="onboarding-col wide">
              <h1 className="onboarding-h1">
                Set a daily card goal
              </h1>
              <p className="onboarding-lead">
                Small daily reps beat long cramming sessions.
              </p>
              <div className="onboarding-big-num" style={{ marginTop: 30 }}>
                <b>{prefs.daily}</b>
                <span>cards / day</span>
              </div>
              <div className="onboarding-minutes">≈ {Math.round(prefs.daily * 0.5)} min a day</div>
              <div style={{ padding: "24px 6px 0" }}>
                <input
                  className="onboarding-range"
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={prefs.daily}
                  onChange={(e) => setPrefs((p) => ({ ...p, daily: Number(e.target.value) }))}
                />
                <div className="onboarding-ticks">
                  <span>5</span>
                  <span>50</span>
                  <span>100</span>
                </div>
              </div>
              <div className="onboarding-presets" style={{ marginTop: 24 }}>
                {DAILY_PRESETS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="onboarding-preset"
                    data-selected={prefs.daily === v}
                    onClick={() => setPrefs((p) => ({ ...p, daily: v }))}
                  >
                    {v} cards
                  </button>
                ))}
              </div>
              <button
                type="button"
                className="onboarding-btn onboarding-btn-primary"
                style={{ marginTop: 30 }}
                onClick={() => go(1)}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "how" && (
          <div className="onboarding-screen">
            <div className="onboarding-col wide">
              <h1 className="onboarding-h1">The right card at the right time</h1>
              <p className="onboarding-lead" style={{ maxWidth: 440, marginLeft: "auto", marginRight: "auto" }}>
                After each card you grade how it went. DeepHaus schedules the next review: sooner if
                it&apos;s slipping, later if it&apos;s stuck.
              </p>
              <div className="onboarding-how-panel">
                <div className="onboarding-timeline">
                  <div className="rail" />
                  {[
                    { x: "Now", cat: "Again", cls: "again" },
                    { x: "+10m", cat: "Hard", cls: "hard" },
                    { x: "+1d", cat: "Good", cls: "good" },
                    { x: "+4d", cat: "Easy", cls: "easy" },
                  ].map((item) => (
                    <div key={item.cat} className={`onboarding-tl ${item.cls}`}>
                      <div className="glyph" aria-hidden>
                        <span style={{ width: "70%" }} />
                        <span style={{ width: "100%" }} />
                        <span style={{ width: "50%" }} />
                      </div>
                      <div className="dot" aria-hidden />
                      <div className="cat">{item.cat}</div>
                      <div className="when">{item.x}</div>
                      <span className="onboarding-grade-mark" aria-hidden />
                    </div>
                  ))}
                </div>
                <div className="onboarding-how-note">Same card. Four futures, picked by how you grade it.</div>
              </div>
              <button
                type="button"
                className="onboarding-btn onboarding-btn-primary"
                style={{ marginTop: 22 }}
                onClick={() => go(1)}
              >
                Got it
              </button>
            </div>
          </div>
        )}

        {step === "source" && (
          <div className="onboarding-screen">
            <div className="onboarding-col wide">
              <h1 className="onboarding-h1">
                Bring in something to study
              </h1>
              <p className="onboarding-lead">
                Don&apos;t have anything handy?{" "}
                <button type="button" className="onboarding-link" onClick={() => setSourceText(SAMPLE_SOURCE_TEXT)}>
                  Start with a sample deck
                </button>
                .
              </p>
              <div className="onboarding-srcbox">
                <textarea
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault();
                      startGenerating();
                    }
                  }}
                  placeholder="Paste notes, a chapter or a lecture transcript"
                  aria-label="Text to study"
                />
                <div className="onboarding-srcmeta">
                  <span>
                    {sourceText.trim()
                      ? `${wordCount(sourceText)} words · ~ ${estimateCards(sourceText)} cards`
                      : null}
                  </span>
                  <button
                    type="button"
                    className="onboarding-src-send"
                    aria-label="Generate deck"
                    title="Generate deck"
                    disabled={!sourceText.trim()}
                    onClick={startGenerating}
                  >
                    <i className="ri-arrow-up-line" aria-hidden />
                  </button>
                </div>
              </div>
              {genError ? <div className="notice notice-error" style={{ marginTop: 12 }}>{genError}</div> : null}
            </div>
          </div>
        )}

        {step === "generating" && (
          <div className="onboarding-screen">
            <div className="onboarding-col center">
              <div className="onboarding-donut">
                <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden>
                  <circle cx="60" cy="60" r="46" stroke="var(--hover)" strokeWidth="6" fill="none" />
                  <circle
                    cx="60"
                    cy="60"
                    r="46"
                    stroke="var(--accent)"
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={`${(genPct / 100) * 2 * Math.PI * 46} ${2 * Math.PI * 46}`}
                    strokeLinecap="round"
                    transform="rotate(-90 60 60)"
                  />
                </svg>
                <div className="num">{Math.round(genPct)}%</div>
              </div>
              <h1 className="onboarding-h1">
                Writing your cards…
              </h1>
              <p className="onboarding-lead" style={{ maxWidth: 380 }}>
                Reading your source and turning the key ideas into questions. Usually about 30 seconds.
              </p>
              <div className="onboarding-gen-list">
                {genItems.map((g) => (
                  <div key={g.label} className="onboarding-gen-item" data-state={g.state}>
                    <i className={g.icon} />
                    <span>{g.label}</span>
                    {g.working ? <small>working…</small> : null}
                  </div>
                ))}
              </div>
              {genError ? (
                <div style={{ marginTop: 20, width: "100%" }}>
                  <div className="notice notice-error">{genError}</div>
                  <button
                    type="button"
                    className="onboarding-btn onboarding-btn-ghost"
                    style={{ marginTop: 12 }}
                    onClick={() => go(-1)}
                  >
                    Go back
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        )}

        {step === "firstcard" && (
          <div className="onboarding-screen">
            <div className="onboarding-col wide">
              <h1 className="onboarding-h1">
                Try your first card
              </h1>
              <p className="onboarding-lead">
                {flipped
                  ? "Now grade how it went. That's the whole loop."
                  : "Read the card, then show the answer."}
              </p>
              <div className="onboarding-flashcard">
                <span className="onboarding-flashcard-pos">Card 1 of {cardCount}</span>
                <div className="q">
                  {firstCard.type === "cloze" && firstCard.clozeText ? (
                    <OnboardingCardContent
                      content={firstCard.clozeText}
                      cloze
                      revealed={flipped}
                    />
                  ) : firstCard.front ? (
                    <>
                      <OnboardingCardContent content={firstCard.front} />
                      {flipped && firstCard.back ? (
                        <m.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={reviewActionTransition}
                          className="onboarding-flashcard-answer"
                        >
                          <div className="onboarding-flashcard-divider" />
                          <OnboardingCardContent content={firstCard.back} />
                        </m.div>
                      ) : null}
                    </>
                  ) : (
                    "The body's natural pacemaker is the SA node."
                  )}
                </div>
              </div>
              <div className="onboarding-review-actions">
                <div className="onboarding-review-slot">
                  <AnimatePresence mode="wait" initial={false}>
                    {!flipped ? (
                      <m.button
                        key="show-answer"
                        type="button"
                        className="onboarding-show-answer"
                        onClick={() => setFlipped(true)}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={reviewActionTransition}
                      >
                        Show answer
                        <kbd className="dh-kbd">Space</kbd>
                      </m.button>
                    ) : (
                      <m.div
                        key="grades"
                        className="onboarding-grades"
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        transition={reviewActionTransition}
                      >
                        {ONBOARDING_REVIEW_GRADES.map((g, i) => (
                          <button
                            key={g.label}
                            type="button"
                            className={`onboarding-grade ${g.cls}`}
                            data-selected={grade === g.label}
                            title={`Press ${onboardingGradeShortcut(i)}`}
                            onClick={() => handleGrade(g.label)}
                          >
                            <em aria-hidden>{g.key}</em>
                            <div className="label">{g.label}</div>
                            <div className="time">{g.time}</div>
                            <span className="onboarding-grade-mark" aria-hidden />
                          </button>
                        ))}
                      </m.div>
                    )}
                  </AnimatePresence>
                </div>
                {flipped ? (
                  <p className="onboarding-foot-hint">Tap a grade to schedule the next review.</p>
                ) : null}
              </div>
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="onboarding-screen">
            <div className="onboarding-col center">
              <div style={{ marginBottom: 16 }}>
                <span className="onboarding-badge">
                  <i className="ri-check-line" /> You&apos;re all set
                </span>
              </div>
              <h1 className="onboarding-h1 big">
                Your first deck is ready
              </h1>
              <p className="onboarding-lead" style={{ maxWidth: 420 }}>
                DeepHaus built {cardCount} cards. At {prefs.daily} a day, you&apos;ll be through the first
                round soon.
              </p>
              <div style={{ margin: "24px 0 4px" }}>
                <CardStackIllustration size="sm" />
              </div>
              <div className="onboarding-deck-card">
                <div className="onboarding-deck-icon">
                  <i className="ri-folder-3-line" />
                </div>
                <div>
                  <div className="onboarding-deck-name">{activeDeck?.deckName ?? "Starter deck"}</div>
                  <div style={{ display: "flex", gap: 12, marginTop: 2 }}>
                    <span className="dh-count dh-count--due">{dueCount} due</span>
                    <span className="dh-count dh-count--new">{newCount} new</span>
                  </div>
                </div>
              </div>
              {genError ? (
                <div className="notice notice-error" style={{ width: "100%", marginTop: 16 }}>
                  {genError}
                </div>
              ) : null}
              <div className="onboarding-btn-row" style={{ marginTop: 28, justifyContent: "center" }}>
                <button
                  type="button"
                  className="onboarding-btn onboarding-btn-primary"
                  disabled={busy}
                  onClick={() => void finish(studyHrefForDeck(deck, previewMode))}
                >
                  Start studying
                </button>
                <button
                  type="button"
                  className="onboarding-btn onboarding-btn-ghost"
                  disabled={busy}
                  onClick={() => void finish("/dashboard")}
                >
                  Go to Home
                </button>
              </div>
              <OnboardingAppsNote />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
