"use client";

import { useRouter } from "next/navigation";
import {
  extractCardMediaDisplayUrls,
  parseCardContent,
  parseImageOcclusionData,
} from "@deephaus/shared";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { StudyCardSkeleton } from "@/components/ui/skeleton-patterns";
import { motionTransition, slideLeft, slideUp } from "@/lib/motion";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { StudyCardPanel, type StudyCardData } from "@/components/study-card-panel";
import { StudyCardTags } from "@/components/study-card-tags";
import {
  StudySessionToolbar,
  STUDY_ACTION_SHORTCUTS,
  studyShortcutLabel,
} from "@/components/study-session-toolbar";
import { useAiContext } from "@/lib/ai-assistant/context";
import { invalidateStudyCaches } from "@/lib/client-cache/prefetch";
import { consumeReviewQueue } from "@/lib/study/review-cache";
import {
  DEFAULT_STUDY_TEXT_SCALE_INDEX,
  clampStudyTextScaleIndex,
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
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
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
  /** Hour (0-23) the study day rolls over — Anki's "next day starts at". */
  day_start_hour?: number;
  /** True when the queue was filled by pulling learning cards ahead of time. */
  learn_ahead?: boolean;
  counts: QueueCounts & { new_today_remaining?: number };
}

const DEFAULT_DAY_START_HOUR = 4;

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

async function fetchQueueFromNetwork(deckId: string): Promise<QueueResponse> {
  const res = await fetch(`/api/decks/${deckId}/review`, { cache: "no-store" });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as QueueResponse;
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

function isLearningState(state: number) {
  return state === 1 || state === 3;
}

function cardCountBucket(card: { is_new: boolean; state: number }): "new" | "learning" | "review" {
  if (card.is_new || card.state === 0) return "new";
  if (isLearningState(card.state)) return "learning";
  return "review";
}

/** Normalize review-queue counts into daily remaining learning / due / new. */
function normalizeQueueCounts(
  counts: QueueCounts & { new_today_remaining?: number },
): QueueCounts {
  return {
    due: counts.due,
    learning: counts.learning,
    // Prefer today's remaining new-card supply over the deck-wide new total.
    new: counts.new_today_remaining ?? counts.new,
    total: counts.total,
  };
}

function removeCardFromCounts(
  counts: QueueCounts,
  bucket: "new" | "learning" | "review",
): QueueCounts {
  if (bucket === "new") {
    return { ...counts, new: Math.max(0, counts.new - 1) };
  }
  if (bucket === "learning") {
    return {
      ...counts,
      learning: Math.max(0, counts.learning - 1),
      due: Math.max(0, counts.due - 1),
    };
  }
  return { ...counts, due: Math.max(0, counts.due - 1) };
}

/** Due before the next day-rollover boundary (Anki's "next day starts at"). */
function isStillDueToday(dueIso: string, asOfMs: number, dayStartHour: number): boolean {
  const dueMs = new Date(dueIso).getTime();
  if (dueMs <= asOfMs) return true;
  const boundary = new Date(asOfMs);
  boundary.setHours(dayStartHour, 0, 0, 0);
  if (boundary.getTime() <= asOfMs) boundary.setDate(boundary.getDate() + 1);
  return dueMs < boundary.getTime();
}

function addDueCardToCounts(
  counts: QueueCounts,
  state: number,
  dueIso: string,
  asOfMs: number,
  dayStartHour: number,
): QueueCounts {
  if (!isStillDueToday(dueIso, asOfMs, dayStartHour)) return counts;
  if (state === 0) {
    return { ...counts, new: counts.new + 1 };
  }
  if (isLearningState(state)) {
    return { ...counts, learning: counts.learning + 1, due: counts.due + 1 };
  }
  if (state === 2) {
    return { ...counts, due: counts.due + 1 };
  }
  return counts;
}

/** Apply a successful review to deck-wide daily remaining counts. */
function applyReviewToCounts(
  counts: QueueCounts,
  before: { is_new: boolean; state: number },
  after: { state: number; due: string },
  dayStartHour: number,
  asOfMs = Date.now(),
): QueueCounts {
  return addDueCardToCounts(
    removeCardFromCounts(counts, cardCountBucket(before)),
    after.state,
    after.due,
    asOfMs,
    dayStartHour,
  );
}

/** Undo a review's effect on deck-wide daily remaining counts. */
function revertReviewFromCounts(
  counts: QueueCounts,
  before: { is_new: boolean; state: number },
  after: { state: number; due: string },
  dayStartHour: number,
  asOfMs = Date.now(),
): QueueCounts {
  let next = counts;
  if (isStillDueToday(after.due, asOfMs, dayStartHour)) {
    if (after.state === 0) {
      next = { ...next, new: Math.max(0, next.new - 1) };
    } else if (isLearningState(after.state)) {
      next = {
        ...next,
        learning: Math.max(0, next.learning - 1),
        due: Math.max(0, next.due - 1),
      };
    } else if (after.state === 2) {
      next = { ...next, due: Math.max(0, next.due - 1) };
    }
  }

  const bucket = cardCountBucket(before);
  if (bucket === "new") return { ...next, new: next.new + 1 };
  if (bucket === "learning") {
    return { ...next, learning: next.learning + 1, due: next.due + 1 };
  }
  return { ...next, due: next.due + 1 };
}

export function StudyMode({ deckId }: { deckId: string; deckTitle: string }) {
  const router = useRouter();
  const [queue, setQueue] = useState<ReviewCard[]>([]);
  const [counts, setCounts] = useState<QueueCounts>({ due: 0, new: 0, learning: 0, total: 0 });
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Checking the server for more due/learning cards after finishing the local queue. */
  const [refilling, setRefilling] = useState(false);
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_START_HOUR);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<SessionStats>({ again: 0, hard: 0, good: 0, easy: 0 });
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ReviewHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<ReviewHistoryEntry[]>([]);
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
      // Use the queue warmed by the deck page / sidebar hover when available so
      // the reviewer renders immediately instead of waiting on a cold fetch.
      let data: QueueResponse | null = null;
      const prefetched = consumeReviewQueue(deckId);
      if (prefetched) {
        try {
          data = (await prefetched) as QueueResponse;
        } catch {
          data = null;
        }
      }
      if (!data) {
        data = await fetchQueueFromNetwork(deckId);
      }
      setQueue(data.cards);
      setCounts(normalizeQueueCounts(data.counts));
      setDayStartHour(data.day_start_hour ?? DEFAULT_DAY_START_HOUR);
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

  // Warm the browser cache for the current card's answer image and the next few
  // cards so images are decoded before they're shown instead of popping in.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const PRELOAD_AHEAD = 3;
    const urls = new Set<string>();
    for (let i = idx; i < Math.min(queue.length, idx + 1 + PRELOAD_AHEAD); i += 1) {
      const card = queue[i];
      if (!card) continue;
      for (const url of extractCardMediaDisplayUrls(
        "study",
        card.front,
        card.back,
        card.cloze_text,
        card.extra,
      )) {
        urls.add(url);
      }
    }
    if (urls.size === 0) return;
    const loaders = [...urls].map((url) => {
      const img = new window.Image();
      img.decoding = "async";
      img.src = url;
      return img;
    });
    return () => {
      for (const img of loaders) img.src = "";
    };
  }, [queue, idx]);

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
        // Don't end the session yet — the deck may still have due or learning
        // cards (including ones re-scheduled during this session). Check the
        // server before showing the completion screen.
        setRefilling(true);
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
        setCounts((prev) =>
          applyReviewToCounts(
            prev,
            { is_new: gradedCard.is_new, state: gradedCard.state },
            { state: data.next_state.state, due: data.next_state.due },
            dayStartHour,
          ),
        );
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
        if (advancingToDone) {
          // Refill from the server: remaining due cards past the session page
          // size, learning cards that came due mid-session, and (when nothing
          // else is left) learning cards pulled ahead by the learn-ahead window.
          try {
            const refreshed = await fetchQueueFromNetwork(deckId);
            if (refreshed.cards.length > 0) {
              setQueue((prev) => [...prev, ...refreshed.cards]);
              setCounts(normalizeQueueCounts(refreshed.counts));
              setIdx(gradedIndex + 1);
            } else {
              setDone(true);
              invalidateStudyCaches();
            }
          } catch {
            // Refill is best-effort; the review itself succeeded.
            setDone(true);
            invalidateStudyCaches();
          } finally {
            setRefilling(false);
          }
        }
      } catch (err) {
        setStats((s) => ({ ...s, [g]: Math.max(0, s[g] - 1) }));
        setRefilling(false);
        setDone(false);
        setIdx(gradedIndex);
        setRevealed(true);
        setError(err instanceof Error ? err.message : "Failed to submit grade");
      }
    },
    [card, idx, queue.length, deckId, dayStartHour],
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
      setCounts((prev) =>
        revertReviewFromCounts(
          prev,
          { is_new: entry.card.is_new, state: entry.card.state },
          { state: entry.nextState.state, due: entry.nextState.due },
          dayStartHour,
        ),
      );
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
  }, [restoreReviewState, submitting, undoStack, dayStartHour]);

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
      setCounts((prev) =>
        applyReviewToCounts(
          prev,
          { is_new: entry.card.is_new, state: entry.card.state },
          { state: entry.nextState.state, due: entry.nextState.due },
          dayStartHour,
        ),
      );
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
  }, [queue.length, restoreReviewState, redoStack, submitting, dayStartHour]);

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
      const suspendedCard = card;
      setRevealed(false);
      setCounts((prev) => removeCardFromCounts(prev, cardCountBucket(suspendedCard)));
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

  if (loading || refilling) {
    return (
      <div className="study-mode-page">
        <div style={s.wrap}>
          <FadeIn>
            <StudyCardSkeleton />
          </FadeIn>
        </div>
      </div>
    );
  }

  if (error && queue.length === 0) {
    return (
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
    );
  }

  if (done) {
    const total = stats.again + stats.hard + stats.good + stats.easy;
    return (
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
                        borderRadius: 8,
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
                <button className="btn btn-primary" onClick={() => router.push(`/decks/${deckId}`)}>
                  Back to deck
                </button>
              </div>
            </div>
          </FadeIn>
        </div>
      </div>
    );
  }

  return (
    <StudyCardView
      card={card}
      revealed={revealed}
      submitting={submitting}
      counts={counts}
      sessionCompleted={stats.again + stats.hard + stats.good + stats.easy}
      error={error}
      deckId={deckId}
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

function StudyHistoryHoverLabel({ label, shortcut }: { label: string; shortcut: string }) {
  return (
    <span className="study-session-hover-label study-session-hover-label--above" role="tooltip" aria-hidden>
      <span className="study-session-hover-label-text">{label}</span>
      <span className="study-session-hover-shortcut">{studyShortcutLabel(shortcut)}</span>
    </span>
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
          className="btn btn-ghost btn-sm study-review-history-btn"
          onClick={() => void onUndo()}
          disabled={!canUndo || submitting}
          aria-label={`Undo (${studyShortcutLabel(STUDY_ACTION_SHORTCUTS.undo)})`}
        >
          <StudyHistoryHoverLabel label="Undo" shortcut={STUDY_ACTION_SHORTCUTS.undo} />
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
          className="btn btn-ghost btn-sm study-review-history-btn"
          onClick={() => void onRedo()}
          disabled={!canRedo || submitting}
          aria-label={`Redo (${studyShortcutLabel(STUDY_ACTION_SHORTCUTS.redo)})`}
        >
          <StudyHistoryHoverLabel label="Redo" shortcut={STUDY_ACTION_SHORTCUTS.redo} />
          <i className="ri-arrow-go-forward-line" />
          Redo
        </button>
      </div>
    </div>
  );
}

function StudyCardView({
  card,
  revealed,
  submitting,
  counts,
  sessionCompleted,
  error,
  deckId,
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
  revealed: boolean;
  submitting: boolean;
  counts: QueueCounts;
  /** Reviews completed this session — drives the deck-wide progress bar. */
  sessionCompleted: number;
  error: string | null;
  deckId: string;
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

  // Expose the current card to the topbar AI assistant.
  useAiContext({
    page: "study-card",
    deckId,
    card: {
      id: card.id,
      type: card.type,
      front: card.front,
      back: card.back,
      cloze_text: card.cloze_text,
      extra: card.extra,
    },
  });

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;

      if (panelMode) {
        // Escape is handled inside StudyCardPanel.
        return;
      }

      if (e.key === STUDY_ACTION_SHORTCUTS.undo) {
        e.preventDefault();
        if (canUndo && !submitting) void undoReview();
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.redo) {
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
        return;
      }

      if (e.key.toLowerCase() === STUDY_ACTION_SHORTCUTS.edit.toLowerCase()) {
        e.preventDefault();
        setPanelMode("edit");
        return;
      }
      if (e.key.toLowerCase() === STUDY_ACTION_SHORTCUTS.explain.toLowerCase()) {
        e.preventDefault();
        setPanelMode("explain");
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.suspend) {
        e.preventDefault();
        if (!submitting) onSuspendCard();
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.zoomOut) {
        e.preventDefault();
        onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex - 1));
        return;
      }
      if (e.key === STUDY_ACTION_SHORTCUTS.zoomIn) {
        e.preventDefault();
        onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    panelMode,
    revealed,
    grade,
    undoReview,
    redoReview,
    canUndo,
    canRedo,
    submitting,
    setRevealed,
    onSuspendCard,
    onTextScaleChange,
    textScaleIndex,
  ]);

  return (
    <>
      <div className="study-mode-page">
        <div style={s.wrap}>
        <div className="study-mode-stage-row">
        <div className="study-mode-stage">
        <div style={s.cardChrome}>
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
                  {card.type === "image-occlusion" ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16, width: "100%" }}>
                      {(() => {
                        const caption = parseCardContent(card.front ?? "")
                          .filter((segment) => segment.type === "text")
                          .map((segment) => segment.value)
                          .join("\n")
                          .trim();
                        return caption ? (
                          <CardContentRenderer content={caption} studyView />
                        ) : null;
                      })()}
                      <OcclusionRenderer
                        data={parseImageOcclusionData(card.occlusion_data)}
                        activeOrd={card.cloze_ord}
                        revealed={revealed}
                        studyView
                      />
                    </div>
                  ) : card.type === "cloze" && card.cloze_text ? (
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
                  {revealed &&
                    (card.type === "basic" || card.type === "image-occlusion") &&
                    (card.back || card.extra) && (
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
            {/* Progress across everything left for the deck today (learning +
                due + new), not just the cards loaded into this session page. */}
            <div
              style={{
                ...s.progressFill,
                width: `${(() => {
                  const remaining = counts.due + counts.new;
                  const total = sessionCompleted + remaining;
                  if (total <= 0) return 100;
                  return Math.min(100, (sessionCompleted / total) * 100);
                })()}%`,
              }}
            />
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
        </div>

        <StudySessionToolbar
          placement="side"
          textScaleIndex={textScaleIndex}
          onTextScaleChange={onTextScaleChange}
          onEdit={() => setPanelMode("edit")}
          onExplain={() => setPanelMode("explain")}
          onSuspend={onSuspendCard}
          suspendDisabled={submitting}
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

      <AnimatePresence>
        {panelMode ? (
          <StudyCardPanel
            key="study-card-panel"
            mode={panelMode}
            card={card}
            onClose={() => setPanelMode(null)}
            onSaved={onCardUpdated}
          />
        ) : null}
      </AnimatePresence>
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
    padding: "24px 40px 32px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
    maxWidth: 940,
    width: "100%",
    margin: "0 auto",
    minHeight: 0,
    overflow: "hidden",
  },
  cardChrome: {
    background: "var(--white)",
    borderRadius: REVIEW_CHROME_RADIUS,
    border: "1px solid var(--border-2)",
    padding: "24px 32px",
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    minHeight: 0,
    position: "relative",
    overflow: "hidden",
  },
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
    flexShrink: 0,
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
