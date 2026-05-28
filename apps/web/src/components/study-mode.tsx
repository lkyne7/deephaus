"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { motionTransition, slideLeft, slideUp } from "@/lib/motion";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { StudyCardPanel, type StudyCardData } from "@/components/study-card-panel";
import { StudyCardTags } from "@/components/study-card-tags";
import { StudyPageHeader } from "@/components/study-page-header";
import { StudyTextSizeControls } from "@/components/study-text-size-controls";
import type { StudyDeckOption } from "@/lib/study/decks";
import {
  DEFAULT_STUDY_TEXT_SCALE_INDEX,
  readStoredStudyTextScaleIndex,
  STUDY_TEXT_SCALE_STEPS,
  studyCardTextStyle,
  writeStoredStudyTextScaleIndex,
} from "@/lib/study/text-scale";
import "@/components/rich-text/rich-text.css";

type Grade = "again" | "hard" | "good" | "easy";

const GRADES: Array<{
  id: Grade;
  rating: 1 | 2 | 3 | 4;
  label: string;
  color: string;
  bg: string;
}> = [
  { id: "again", rating: 1, label: "Again", color: "var(--grade-again)", bg: "var(--grade-again-bg)" },
  { id: "hard", rating: 2, label: "Hard", color: "var(--grade-hard)", bg: "var(--grade-hard-bg)" },
  { id: "good", rating: 3, label: "Good", color: "var(--grade-good)", bg: "var(--grade-good-bg)" },
  { id: "easy", rating: 4, label: "Easy", color: "var(--grade-easy)", bg: "var(--grade-easy-bg)" },
];

interface ReviewCard {
  id: string;
  queue_key: string;
  cloze_ord: number | null;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  state: number;
  due: string;
  reps: number;
  lapses: number;
  is_new: boolean;
  intervals: Record<Grade, string>;
}

interface QueueCounts {
  due: number;
  new: number;
  learning: number;
  total: number;
}

interface QueueResponse {
  deck: { id: string; name: string };
  cards: ReviewCard[];
  counts: QueueCounts;
}

interface SessionStats {
  again: number;
  hard: number;
  good: number;
  easy: number;
}

interface CardReviewSnapshot {
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  reps: number;
  lapses: number;
  state: number;
  last_review: string | null;
  learning_steps: number;
}

interface ReviewLogSnapshot {
  rating: number;
  state: number;
  due: string;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  last_elapsed_days: number;
  scheduled_days: number;
  review: string;
}

interface ReviewHistoryEntry {
  cardIndex: number;
  card: ReviewCard;
  grade: Grade;
  previousState: CardReviewSnapshot | null;
  nextState: CardReviewSnapshot;
  log: ReviewLogSnapshot;
}

interface GradeResponse {
  previous_state: CardReviewSnapshot | null;
  next_state: CardReviewSnapshot;
  log: ReviewLogSnapshot;
  state: number;
  due: string;
  reps: number;
  lapses: number;
  intervals: Record<Grade, string>;
}

interface RestoreResponse {
  state: number;
  due: string;
  reps: number;
  lapses: number;
  is_new: boolean;
  intervals: Record<Grade, string>;
}

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

function applyRestoreToCard(card: ReviewCard, restored: RestoreResponse): ReviewCard {
  return {
    ...card,
    state: restored.state,
    due: restored.due,
    reps: restored.reps,
    lapses: restored.lapses,
    is_new: restored.is_new,
    intervals: restored.intervals,
  };
}

export function StudyMode({ deckId, deckTitle }: { deckId: string; deckTitle: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [counts, setCounts] = useState<QueueCounts>({ due: 0, new: 0, learning: 0, total: 0 });
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ReviewHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<ReviewHistoryEntry[]>([]);
  const [studyDecks, setStudyDecks] = useState<StudyDeckOption[]>([]);
  const [textScaleIndex, setTextScaleIndex] = useState(DEFAULT_STUDY_TEXT_SCALE_INDEX);

  const setTextScale = useCallback((index: number) => {
    setTextScaleIndex(index);
    writeStoredStudyTextScaleIndex(index);
  }, []);

  useEffect(() => {
    setTextScaleIndex(readStoredStudyTextScaleIndex());
  }, []);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${deckId}/review`, { cache: "no-store" });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as QueueResponse;
      setQueue(data.cards);
      setCounts(data.counts);
      setIdx(0);
      setRevealed(false);
      setDone(data.cards.length === 0);
      setUndoStack([]);
      setRedoStack([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [deckId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/study/decks", { cache: "no-store" });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { decks: StudyDeckOption[] };
        if (!cancelled) setStudyDecks(data.decks ?? []);
      } catch {
        // Deck switcher is optional — study still works without it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [deckId]);

  const card = queue[idx];

  const restoreReviewState = useCallback(
    async (
      entry: ReviewHistoryEntry,
      mode: "undo" | "redo",
    ): Promise<RestoreResponse | null> => {
      const res = await fetch(`/api/cards/${entry.card.id}/review/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cloze_ord: entry.card.cloze_ord ?? 0,
          review_state: mode === "undo" ? entry.previousState : entry.nextState,
          log_action: mode === "undo" ? "delete_latest" : "insert",
          log: mode === "redo" ? entry.log : undefined,
        }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      }
      return (await res.json()) as RestoreResponse;
    },
    [],
  );

  const grade = useCallback(
    async (g: Grade) => {
      if (!card) return;

      const gradedIndex = idx;
      const gradedCard = card;
      const gradeMeta = GRADES.find((x) => x.id === g)!;
      const advancingToDone = gradedIndex + 1 >= queue.length;

      setRevealed(false);
      setStats((s) => ({ ...s, [g]: s[g] + 1 }));
      if (advancingToDone) {
        setDone(true);
      } else {
        setIdx(gradedIndex + 1);
      }

      setError(null);
      try {
        const res = await fetch(`/api/cards/${gradedCard.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rating: gradeMeta.rating,
            cloze_ord: gradedCard.cloze_ord ?? 0,
          }),
          keepalive: true,
        });
        if (!res.ok) {
          throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as GradeResponse;
        setUndoStack((stack) => [
          ...stack,
          {
            cardIndex: gradedIndex,
            card: gradedCard,
            grade: g,
            previousState: data.previous_state,
            nextState: data.next_state,
            log: data.log,
          },
        ]);
        setRedoStack([]);
      } catch (err) {
        setStats((s) => ({ ...s, [g]: Math.max(0, s[g] - 1) }));
        setDone(false);
        setIdx(gradedIndex);
        setRevealed(true);
        setError(err instanceof Error ? err.message : "Failed to submit grade");
      }
    },
    [card, idx, queue.length],
  );

  const undoReview = useCallback(async () => {
    if (submitting || undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    setSubmitting(true);
    setError(null);
    try {
      const restored = await restoreReviewState(entry, "undo");
      if (!restored) return;
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [...stack, entry]);
      setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
      setQueue((prev) =>
        prev.map((c, i) => (i === entry.cardIndex ? applyRestoreToCard(c, restored) : c)),
      );
      setDone(false);
      setIdx(entry.cardIndex);
      setRevealed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo review");
    } finally {
      setSubmitting(false);
    }
  }, [restoreReviewState, submitting, undoStack]);

  const redoReview = useCallback(async () => {
    if (submitting || redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    setSubmitting(true);
    setError(null);
    try {
      const restored = await restoreReviewState(entry, "redo");
      if (!restored) return;
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack, entry]);
      setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
      setQueue((prev) =>
        prev.map((c, i) => (i === entry.cardIndex ? applyRestoreToCard(c, restored) : c)),
      );
      setRevealed(false);
      if (entry.cardIndex + 1 >= queue.length) {
        setDone(true);
      } else {
        setIdx(entry.cardIndex + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to redo review");
    } finally {
      setSubmitting(false);
    }
  }, [queue.length, restoreReviewState, redoStack, submitting]);

  const suspendCurrentCard = useCallback(async () => {
    if (!card || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/cards/${card.id}/suspend`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ suspended: true }),
      });
      if (!res.ok) {
        throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
      }
      const suspendedIndex = idx;
      setRevealed(false);
      setQueue((prev) => {
        const next = prev.filter((_, i) => i !== suspendedIndex);
        if (next.length === 0) {
          setDone(true);
          setIdx(0);
        } else if (suspendedIndex >= next.length) {
          setIdx(next.length - 1);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to suspend card");
    } finally {
      setSubmitting(false);
    }
  }, [card, idx, submitting]);

  if (loading) {
    return (
      <>
        <StudyPageHeader deckId={deckId} deckTitle={deckTitle} studyDecks={studyDecks} />
        <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
              <i className="ri-loader-4-line icon-spin" style={{ fontSize: 32, color: "var(--ink-300)" }} />
              <p style={{ marginTop: 12, color: "var(--fg-3)" }}>Loading review queue…</p>
            </div>
          </FadeIn>
        </div>
      </div>
      </>
    );
  }

  if (error && queue.length === 0) {
    return (
      <>
        <StudyPageHeader deckId={deckId} deckTitle={deckTitle} studyDecks={studyDecks} />
        <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
              <i className="ri-error-warning-line" style={{ fontSize: 32, color: "var(--grade-again)" }} />
              <p style={{ marginTop: 12, color: "var(--fg-3)" }}>{error}</p>
              <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => void loadQueue()}>
                Retry
              </button>
            </div>
          </FadeIn>
        </div>
      </div>
      </>
    );
  }

  if (done) {
    const total = stats.again + stats.hard + stats.good + stats.easy;
    const nextDeck = studyDecks.find((d) => d.id !== deckId && d.waiting > 0);
    return (
      <>
        <StudyPageHeader deckId={deckId} deckTitle={deckTitle} studyDecks={studyDecks} />
        <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <div className="surface" style={{ padding: 48, textAlign: "center", maxWidth: 560, margin: "0 auto" }}>
              <i className="ri-check-double-line" style={{ fontSize: 48, color: "var(--grade-easy)" }} />
              <h2 className="display-xs" style={{ marginTop: 16 }}>
                {total === 0 ? "All caught up" : "Session Complete"}
              </h2>
              <p style={{ color: "var(--fg-3)", marginTop: 8 }}>
                {total === 0
                  ? "No cards are due for review right now."
                  : `You reviewed ${total} card${total === 1 ? "" : "s"}.`}
              </p>
              {total > 0 && (
                <div style={{ display: "flex", gap: 12, justifyContent: "center", marginTop: 24, flexWrap: "wrap" }}>
                  {GRADES.map((g, i) => (
                    <m.div
                      key={g.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.04, duration: 0.24 }}
                      style={{
                        padding: "10px 16px",
                        borderRadius: 12,
                        background: g.bg,
                        color: g.color,
                        font: "500 13px/16px var(--font-sans)",
                      }}
                    >
                      {g.label}: {stats[g.id]}
                    </m.div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 32, flexWrap: "wrap" }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setStats({ again: 0, hard: 0, good: 0, easy: 0 });
                    setUndoStack([]);
                    setRedoStack([]);
                    void loadQueue();
                  }}
                >
                  {total === 0 ? "Refresh" : "Study More"}
                </button>
                {nextDeck ? (
                  <button
                    className="btn btn-primary"
                    onClick={() => router.push(`/decks/${nextDeck.id}/study`)}
                  >
                    Study {nextDeck.title}
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={() => router.push("/study")}>
                    Study hub
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => router.push(`/decks/${deckId}`)}>
                  Deck details
                </button>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
      </>
    );
  }

  return (
    <StudyCardView
      card={card}
      idx={idx}
      queue={queue}
      revealed={revealed}
      submitting={submitting}
      counts={counts}
      error={error}
      deckId={deckId}
      deckTitle={deckTitle}
      studyDecks={studyDecks}
      grade={grade}
      undoReview={undoReview}
      redoReview={redoReview}
      canUndo={undoStack.length > 0}
      canRedo={redoStack.length > 0}
      setRevealed={setRevealed}
      textScaleIndex={textScaleIndex}
      onTextScaleChange={setTextScale}
      onCardUpdated={(updated) => {
        setQueue((prev) => prev.map((c, i) => (i === idx ? { ...c, ...updated } : c)));
      }}
      onSuspendCard={() => void suspendCurrentCard()}
    />
  );
}

function StudyReviewFooterRow({
  counts,
  canUndo,
  canRedo,
  submitting,
  onUndo,
  onRedo,
}: {
  counts: QueueCounts;
  canUndo: boolean;
  canRedo: boolean;
  submitting: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const dueRemaining = Math.max(0, counts.due - counts.learning);

  return (
    <div style={s.reviewFooterBar}>
      <div style={s.reviewFooterSide}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void onUndo()}
          disabled={!canUndo || submitting}
          title="Undo (⌘Z)"
        >
          <i className="ri-arrow-go-back-line" />
          Undo
        </button>
      </div>

      <div style={s.reviewFooterCenter}>
        <span className="chip chip-learning">
          <span className="chip-dot" />
          {counts.learning} learning
        </span>
        <span className="chip chip-due">
          <span className="chip-dot" />
          {dueRemaining} due
        </span>
        <span className="chip chip-new">
          <span className="chip-dot" />
          {counts.new} new
        </span>
      </div>

      <div style={{ ...s.reviewFooterSide, justifyContent: "flex-end" }}>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => void onRedo()}
          disabled={!canRedo || submitting}
          title="Redo (⌘⇧Z)"
        >
          <i className="ri-arrow-go-forward-line" />
          Redo
        </button>
      </div>
    </div>
  );
}

function StudyCardView({
  card,
  idx,
  queue,
  revealed,
  submitting,
  counts,
  error,
  deckId,
  deckTitle,
  studyDecks,
  grade,
  undoReview,
  redoReview,
  canUndo,
  canRedo,
  setRevealed,
  textScaleIndex,
  onTextScaleChange,
  onCardUpdated,
  onSuspendCard,
}: {
  card: ReviewCard;
  idx: number;
  queue: ReviewCard[];
  revealed: boolean;
  submitting: boolean;
  counts: QueueCounts;
  error: string | null;
  deckId: string;
  deckTitle: string;
  studyDecks: StudyDeckOption[];
  grade: (g: Grade) => void;
  undoReview: () => void;
  redoReview: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setRevealed: (v: boolean) => void;
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
  onCardUpdated: (updated: StudyCardData) => void;
  onSuspendCard: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const transition = motionTransition(undefined, undefined, reducedMotion ?? false);
  const [panelMode, setPanelMode] = useState<"edit" | "explain" | null>(null);
  const cardTextStyle = studyCardTextStyle(STUDY_TEXT_SCALE_STEPS[textScaleIndex]);

  useEffect(() => {
    setPanelMode(null);
  }, [card.queue_key]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (panelMode || isTypingTarget(e.target)) return;

      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) {
          if (canRedo && !submitting) void redoReview();
        } else if (canUndo && !submitting) {
          void undoReview();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        if (canRedo && !submitting) void redoReview();
        return;
      }

      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        if (!revealed) {
          setRevealed(true);
        } else {
          void grade("good");
        }
        return;
      }

      if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        void grade(GRADES[Number(e.key) - 1].id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelMode, revealed, grade, undoReview, redoReview, canUndo, canRedo, submitting, setRevealed]);

  return (
    <>
      <StudyPageHeader
        deckId={deckId}
        deckTitle={deckTitle}
        studyDecks={studyDecks}
        sessionActions={
          <>
            <StudyTextSizeControls scaleIndex={textScaleIndex} onChange={onTextScaleChange} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanelMode("edit")}>
              <i className="ri-pencil-line" />
              Edit
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPanelMode("explain")}>
              <i className="ri-sparkling-2-line" />
              Explain
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={onSuspendCard}
              disabled={submitting}
              title="Suspend this card"
            >
              <i className="ri-pause-circle-line" />
              Suspend
            </button>
          </>
        }
      />
      <div className="study-mode-page">
        <div style={s.wrap}>
        <div style={s.cardChrome}>
          <div style={s.chipRow}>
            <span className="chip chip-due">
              <span className="chip-dot" />
              Card {idx + 1} of {queue.length}
            </span>
            {card.is_new ? (
              <span className="chip chip-new">
                <span className="chip-dot" />
                New
              </span>
            ) : card.state === 1 || card.state === 3 ? (
              <span className="chip chip-due">
                <span className="chip-dot" />
                Learning
              </span>
            ) : (
              <span className="chip chip-new">
                <span className="chip-dot" />
                Review
              </span>
            )}
          </div>

          <AnimatePresence mode="wait">
            <m.div
              key={card.queue_key}
              className="study-card-face"
              variants={slideLeft}
              initial="initial"
              animate="animate"
              exit="exit"
              transition={transition}
            >
              <div className="study-card-question">
                <div style={cardTextStyle}>
                  {card.type === "cloze" && card.cloze_text ? (
                    <CardContentRenderer
                      content={card.cloze_text}
                      clozeMode={revealed ? "revealed" : "hidden"}
                      activeClozeOrd={card.cloze_ord}
                      studyView
                    />
                  ) : (
                    <CardContentRenderer content={card.front} studyView />
                  )}
                </div>
              </div>

              <div className="study-card-answer">
                <AnimatePresence>
                  {revealed && card.type === "basic" && (card.back || card.extra) && (
                    <m.div
                      key="back"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={transition}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}
                    >
                      <div style={s.divider} />
                      <div style={cardTextStyle}>
                        <CardContentRenderer content={card.back ?? card.extra} studyView />
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
                <AnimatePresence>
                  {revealed && card.type === "cloze" && card.extra && (
                    <m.div
                      key="back"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={transition}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 24, width: "100%" }}
                    >
                      <div style={s.divider} />
                      <div style={cardTextStyle}>
                        <CardContentRenderer content={card.extra} studyView />
                      </div>
                    </m.div>
                  )}
                </AnimatePresence>
              </div>
            </m.div>
          </AnimatePresence>

          <StudyCardTags tags={card.tags ?? []} />

          <div style={s.progressBar}>
            <div style={{ ...s.progressFill, width: `${((idx + (revealed ? 1 : 0)) / queue.length) * 100}%` }} />
          </div>
        </div>

        <div style={s.reviewChrome}>
          <div style={s.reviewPrimaryRow}>
            <AnimatePresence mode="wait" initial={false}>
              {revealed ? (
                <m.div
                  key="grades"
                  style={s.gradeBar}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                >
                  {GRADES.map((g, i) => (
                    <m.button
                      key={g.id}
                      className="study-grade-btn"
                      onClick={() => void grade(g.id)}
                      disabled={submitting}
                      whileHover={{ backgroundColor: g.bg }}
                      whileTap={{ scale: 0.98 }}
                      style={{
                        ...s.gradeBtn,
                        borderRight: i === GRADES.length - 1 ? 0 : "1px solid var(--border-1)",
                        borderTopLeftRadius: i === 0 ? REVIEW_CHROME_INNER_RADIUS : 0,
                        borderTopRightRadius: i === GRADES.length - 1 ? REVIEW_CHROME_INNER_RADIUS : 0,
                        cursor: submitting ? "not-allowed" : "pointer",
                      }}
                    >
                      <span className="study-shortcut-popup" role="tooltip">
                        {g.id === "good" ? "3 · Space" : String(i + 1)}
                      </span>
                      <div style={{ font: "600 14px/1 var(--font-sans)", color: g.color, width: "100%", textAlign: "center" }}>
                        {g.label}
                      </div>
                      <div style={s.gradeMeta}>{card.intervals[g.id]}</div>
                    </m.button>
                  ))}
                </m.div>
              ) : (
                <m.button
                  key="show"
                  type="button"
                  className="study-show-btn"
                  onClick={() => setRevealed(true)}
                  style={s.showBtn}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                  whileTap={{ scale: 0.995 }}
                >
                  <span className="study-shortcut-popup" role="tooltip">
                    Space
                  </span>
                  <span>Show Answer</span>
                </m.button>
              )}
            </AnimatePresence>
          </div>
          <StudyReviewFooterRow
            counts={counts}
            canUndo={canUndo}
            canRedo={canRedo}
            submitting={submitting}
            onUndo={undoReview}
            onRedo={redoReview}
          />
        </div>

        <AnimatePresence>
          {error && (
            <m.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={transition}
              style={{
                padding: "10px 14px",
                borderRadius: 8,
                background: "var(--grade-again-bg)",
                color: "var(--grade-again)",
                font: "500 13px/18px var(--font-sans)",
                textAlign: "center",
              }}
            >
              {error}
            </m.div>
          )}
        </AnimatePresence>

        </div>

      {panelMode && (
        <StudyCardPanel
          mode={panelMode}
          card={card}
          onClose={() => setPanelMode(null)}
          onSaved={onCardUpdated}
        />
      )}
      </div>
    </>
  );
}

const REVIEW_PRIMARY_ROW_HEIGHT = 72;
const REVIEW_CHROME_RADIUS = 12;
/** Inner radius when the chrome has a 1px border. */
const REVIEW_CHROME_INNER_RADIUS = REVIEW_CHROME_RADIUS - 1;

const s: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    padding: "32px 40px",
    display: "flex",
    flexDirection: "column",
    gap: 20,
    maxWidth: 880,
    width: "100%",
    margin: "0 auto",
    minHeight: 0,
  },
  cardChrome: {
    background: "var(--white)",
    borderRadius: 16,
    border: "1px solid var(--border-2)",
    padding: "24px 32px",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minHeight: 520,
    position: "relative",
    overflow: "hidden",
  },
  chipRow: { display: "flex", justifyContent: "space-between" },
  divider: { width: "60%", height: 1, background: "var(--border-1)" },
  progressBar: { position: "absolute", left: 0, right: 0, bottom: 0, height: 3, background: "var(--ink-50)" },
  progressFill: { height: 3, background: "var(--teal-500)", transition: "width .25s" },
  showBtn: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
    height: "100%",
    minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
    background: "var(--ink-700)",
    color: "var(--white)",
    border: 0,
    padding: "0 20px",
    font: "500 16px/20px var(--font-sans)",
    textAlign: "center",
    cursor: "pointer",
    borderTopLeftRadius: REVIEW_CHROME_INNER_RADIUS,
    borderTopRightRadius: REVIEW_CHROME_INNER_RADIUS,
  },
  gradeMeta: {
    font: "400 11px/1 var(--font-sans)",
    color: "var(--fg-4)",
    marginTop: 6,
    width: "100%",
    textAlign: "center",
  },
  reviewChrome: {
    background: "var(--white)",
    borderRadius: REVIEW_CHROME_RADIUS,
    border: "1px solid var(--border-2)",
    overflow: "visible",
  },
  reviewPrimaryRow: {
    height: REVIEW_PRIMARY_ROW_HEIGHT,
    borderBottom: "1px solid var(--border-1)",
    overflow: "visible",
  },
  gradeBar: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    width: "100%",
    height: "100%",
    minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
  },
  reviewFooterBar: {
    display: "grid",
    gridTemplateColumns: "1fr auto 1fr",
    alignItems: "center",
    gap: 12,
    padding: "10px 16px",
  },
  reviewFooterSide: {
    display: "flex",
    alignItems: "center",
    minWidth: 0,
  },
  reviewFooterCenter: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  gradeBtn: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
    padding: "0 8px",
    textAlign: "center",
    border: 0,
    background: "var(--white)",
    transition: "background .15s",
  },
};
