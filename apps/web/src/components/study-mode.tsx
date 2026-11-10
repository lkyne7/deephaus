"use client";
import {cardCountBucket,applyReviewToCounts,revertReviewFromCounts,removeCardFromCounts} from "@deephaus/scheduling";
import {
  examStudyOverlap,
  responseMsSince,
  studyNow,
  type CardFieldFix,
  type ExamListResponse,
  type ExamSummaryDto,
} from "@deephaus/shared";

import Link from "next/link";
import { useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { DeckSubscriptionSync } from "@/components/deck-subscription-sync";
import { StudyCardPanel, type StudyCardData } from "@/components/study-card-panel";
import { STUDY_GRADES } from "@/components/study-review-chrome";
import {
  formatSessionLength,
  StudyCardFace,
  StudyComplete,
  StudyDock,
  StudyError,
  StudyFrame,
  StudyHeader,
  StudyMessage,
  StudyMeta,
  StudyMissedPill,
  missedAnswerLabel,
  StudyMoreMenu,
  StudySkeleton,
} from "@/components/study/study-chrome";
import {
  useStudyPanel,
  useStudyPreferences,
  useStudyShortcuts,
} from "@/components/study/use-study-session-controls";
import { useAiContext } from "@/lib/ai-assistant/context";
import { invalidateStudyCaches } from "@/lib/client-cache/prefetch";
import { cacheKeys } from "@/lib/client-cache/keys";
import {
  chainStudyQueues,
  pickReviewDecks,
  sumQueueCounts,
  type ChainedPage,
  type StudyQueueChain,
} from "@/lib/study/combined-queue";
import type { StudyDeckOption } from "@/lib/study/decks";
import { consumeReviewQueue } from "@/lib/study/review-cache";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import { useStudyMediaPreload } from "@/lib/study/use-study-media-preload";

type Grade = "again" | "hard" | "good" | "easy";

const GRADES = STUDY_GRADES;

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
  /** Set by exam queues, whose cards come from several decks. */
  deck_id?: string;
  deck_name?: string;
}

/** A card in the session, tagged with the deck it came from. */
interface SessionCard extends ReviewCard {
  deck_id: string;
  deck_name: string;
  /** The queue the card was served by (a deck, or an exam), which owns its counts. */
  source_id: string;
  /** Set when an exam's queue served the card: its answer counts towards that exam. */
  exam_id?: string;
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
  offline_media_deferred?: number;
  counts: QueueCounts & {
    new_today_remaining?: number;
    new_held_back?: number;
    new_per_day_limit?: number;
  };
  /** Exam queues only. */
  exam?: { next_session_at: string | null };
  skipped?: number;
  next_ready_at?: string | null;
}

/** What an exam session shows once nothing more is ready. */
interface ExamSessionEnd {
  skipped: number;
  nextAt: string | null;
}

const DEFAULT_DAY_START_HOUR = 4;

const EMPTY_COUNTS: QueueCounts = { due: 0, new: 0, learning: 0, total: 0 };

const EMPTY_STATS: SessionStats = { again: 0, hard: 0, good: 0, easy: 0 };

type HeldBackNew = { count: number; limit: number };

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
  /** FSRS-7 fast trace; absent on states scheduled with FSRS-6. */
  stability_fast?: number | null;
  fsrs_version?: number | null;
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
  reviewId?: string;
  cardIndex: number;
  card: SessionCard;
  grade: Grade;
  previousState: CardReviewSnapshot | null;
  nextState: CardReviewSnapshot;
  log: ReviewLogSnapshot;
}

interface GradeResponse {
  review_id?: string;
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

async function fetchQueueFromNetwork(
  sourceId: string,
  kind: "deck" | "exam" = "deck",
): Promise<QueueResponse> {
  const path = kind === "exam" ? `/api/exams/${sourceId}/queue` : `/api/decks/${sourceId}/review`;
  const res = await apiFetch(path, { cache: "no-store" });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as QueueResponse;
}

/** Cards left in the session page when the next page is fetched in the background. */
const REFILL_AHEAD = 3;

/** A next-page fetch started before the session page ran out. */
interface PendingRefill {
  /** Null until the fetch lands, and when no deck has more cards. */
  page: ChainedPage<QueueResponse> | null;
}

/** Cards for the session from one queue's page. */
function sessionCards({ deckId, queue }: ChainedPage<QueueResponse>): SessionCard[] {
  return queue.cards.map((card) => ({
    ...card,
    deck_id: card.deck_id ?? deckId,
    deck_name: card.deck_name ?? queue.deck.name,
    source_id: deckId,
    exam_id: queue.exam ? deckId : undefined,
  }));
}

/** "at 4:30 pm", or "tomorrow at 8:00 am" and so on for later days. */
function nextPassLabel(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(at) - midnight(now)) / 86_400_000);
  if (days <= 0) return `at ${time}`;
  if (days === 1) return `tomorrow at ${time}`;
  return `on ${at.toLocaleDateString([], { weekday: "long" })} at ${time}`;
}

/**
 * Decks for a combined session. With `only`, just those decks (a paused deck
 * picked on purpose is kept); otherwise every deck that isn't paused.
 */
async function fetchReviewDecks(only?: string[]): Promise<StudyDeckOption[]> {
  const res = await apiFetch(cacheKeys.studyDecks, { cache: "no-store" });
  if (!res.ok) {
    throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { decks?: StudyDeckOption[] };
  const decks = body.decks ?? [];
  const chosen = only ? new Set(only) : null;
  return pickReviewDecks(
    chosen ? decks.filter((deck) => chosen.has(deck.id)) : decks.filter((deck) => !deck.paused),
  );
}

/** Exams with cards worth studying now, soonest exam first. A failed fetch is no exams. */
async function fetchReadyExams(): Promise<ExamSummaryDto[]> {
  try {
    const res = await apiFetch(cacheKeys.exams, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as ExamListResponse;
    return (body.exams ?? [])
      .filter((exam) => exam.status === "active" && exam.ready_now > 0)
      .sort((a, b) => Date.parse(a.exam_at) - Date.parse(b.exam_at));
  } catch {
    return [];
  }
}

/** "next review tomorrow", from the soonest due date among the reviewed cards. */
function nextReviewLabel(entries: ReviewHistoryEntry[], now = new Date()): string | null {
  if (entries.length === 0) return null;
  const soonest = new Date(
    Math.min(...entries.map((entry) => new Date(entry.nextState.due).getTime())),
  );
  const midnight = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((midnight(soonest) - midnight(now)) / 86_400_000);
  if (days <= 0) return "next review later today";
  if (days === 1) return "next review tomorrow";
  return `next review in ${days} days`;
}

function applyRestoreToCard(card: SessionCard, restored: RestoreResponse): SessionCard {
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

/**
 * Reviews one deck, one exam, or with neither everything there is to study
 * today: each exam with cards ready, then each deck with work, chained into a
 * single session (see study-chain in @deephaus/shared). An exam's cards are
 * ordinary cards: they are graded through the same route, marked as exam study.
 * `deckIds` narrows the combined session to the decks picked on the Decks
 * page, studied on their own without exams.
 */
export function StudyMode({
  deckId,
  deckTitle,
  examId,
  deckIds,
}: {
  deckId?: string;
  deckTitle?: string;
  examId?: string;
  deckIds?: string[];
}) {
  const router = useRouter();
  // A string key, so a new array holding the same ids doesn't reload the queue.
  const pickedKey =
    !deckId && !examId && deckIds && deckIds.length > 0 ? deckIds.join(",") : null;
  const [mediaDeferredByDeck, setMediaDeferredByDeck] = useState<Record<string, number>>({});
  const [queue, setQueue] = useState<SessionCard[]>([]);
  const [countsByDeck, setCountsByDeck] = useState<Record<string, QueueCounts>>({});
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Checking the server for more due/learning cards after finishing the local queue. */
  const [refilling, setRefilling] = useState(false);
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_START_HOUR);
  const [submitting, setSubmitting] = useState(false);
  const [stats, setStats] = useState<SessionStats>(EMPTY_STATS);
  const [error, setError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<ReviewHistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<ReviewHistoryEntry[]>([]);
  const { textScaleIndex, setTextScale, audioAutoplay, setAudioAutoplay } = useStudyPreferences();
  /** New cards excluded by today's daily limit, so the end screen can explain why. */
  const [heldBackByDeck, setHeldBackByDeck] = useState<Record<string, HeldBackNew>>({});
  /** Decks subscribed from the community, kept up to date during a combined session. */
  const [communityDeckIds, setCommunityDeckIds] = useState<string[]>([]);
  const [examName, setExamName] = useState<string | null>(null);
  const [examEnd, setExamEnd] = useState<ExamSessionEnd>({ skipped: 0, nextAt: null });

  const chain = useRef<StudyQueueChain<QueueResponse> | null>(null);
  const pendingRefill = useRef<PendingRefill | null>(null);
  const savingQueueKeys = useRef(new Set<string>());
  const startedAt = useRef(Date.now());
  const shownAtRef = useRef(Date.now());

  const counts = useMemo(() => sumQueueCounts(countsByDeck, EMPTY_COUNTS), [countsByDeck]);
  const mediaDeferred = Object.values(mediaDeferredByDeck).reduce((sum, n) => sum + n, 0);

  const updateCounts = useCallback(
    (deck: string, update: (counts: QueueCounts) => QueueCounts) => {
      setCountsByDeck((prev) => ({ ...prev, [deck]: update(prev[deck] ?? EMPTY_COUNTS) }));
    },
    [],
  );

  const recordPage = useCallback((deck: string, page: QueueResponse) => {
    if (page.exam) {
      // Only read in a single-exam session, where there is one exam to name.
      setExamName(page.deck.name);
      setExamEnd({
        skipped: page.skipped ?? 0,
        nextAt: page.next_ready_at ?? page.exam.next_session_at,
      });
    }
    setMediaDeferredByDeck((prev) => ({ ...prev, [deck]: page.offline_media_deferred ?? 0 }));
    setHeldBackByDeck((prev) => {
      const { [deck]: _stale, ...rest } = prev;
      const count = page.counts.new_held_back ?? 0;
      return count > 0
        ? { ...rest, [deck]: { count, limit: page.counts.new_per_day_limit ?? 0 } }
        : rest;
    });
  }, []);

  const loadQueue = useCallback(async () => {
    pendingRefill.current = null;
    setLoading(true);
    setError(null);
    try {
      const single = deckId || examId;
      const picked = pickedKey?.split(",");
      // Decks picked on the Decks page are studied on their own, without exams.
      const [decks, exams] = single
        ? [null, []]
        : await Promise.all([
            fetchReviewDecks(picked),
            picked ? Promise.resolve<ExamSummaryDto[]>([]) : fetchReadyExams(),
          ]);
      const examIds = new Set(examId ? [examId] : exams.map((exam) => exam.id));
      // Use the queue warmed by the deck page / sidebar hover when available so
      // the reviewer renders immediately instead of waiting on a cold fetch.
      let warmed = deckId ? consumeReviewQueue(deckId) : null;
      const fetchDeck = async (id: string) => {
        const pending = warmed;
        warmed = null;
        if (pending) {
          try {
            return (await pending) as QueueResponse;
          } catch {
            // Fall through to a fresh fetch.
          }
        }
        return fetchQueueFromNetwork(id, examIds.has(id) ? "exam" : "deck");
      };

      setMediaDeferredByDeck({});
      setHeldBackByDeck({});
      chain.current = chainStudyQueues<ReviewCard, QueueResponse>(
        // Exam work first: it is the part with a deadline.
        decks ? [...exams.map((exam) => exam.id), ...decks.map((deck) => deck.id)] : [single!],
        fetchDeck,
        recordPage,
      );
      const page = await chain.current.next(new Set());

      setCommunityDeckIds(decks?.filter((deck) => deck.is_community).map((deck) => deck.id) ?? []);
      // An exam and a deck often want the same cards. The exam's session comes
      // first, so its share is taken off the deck's own counts.
      const overlap = examStudyOverlap(exams, decks ?? []).byDeck;
      setCountsByDeck({
        ...Object.fromEntries(
          exams.map((exam) => {
            const ready = exam.ready_by_deck.reduce(
              (sum, deck) => ({ due: sum.due + deck.due + deck.early, new: sum.new + deck.new }),
              { due: 0, new: 0 },
            );
            return [exam.id, { ...ready, learning: 0, total: exam.ready_now }];
          }),
        ),
        ...Object.fromEntries(
          (decks ?? []).map((deck) => {
            const covered = overlap.get(deck.id) ?? { due: 0, new: 0 };
            const due = Math.max(0, deck.due - covered.due);
            const fresh = Math.max(0, deck.new - covered.new);
            return [deck.id, { due, new: fresh, learning: 0, total: due + fresh }];
          }),
        ),
        ...(page ? { [page.deckId]: normalizeQueueCounts(page.queue.counts) } : {}),
      });
      setQueue(page ? sessionCards(page) : []);
      setDayStartHour(page?.queue.day_start_hour ?? DEFAULT_DAY_START_HOUR);
      setIdx(0);
      setRevealed(false);
      setDone(!page);
      setUndoStack([]);
      setRedoStack([]);
      startedAt.current = Date.now();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [deckId, examId, pickedKey, recordPage]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Decode the current card's answer images and the next few cards before they
  // are shown so they never pop in.
  useStudyMediaPreload(queue, idx);

  // Fetch the next page a few cards before this one runs out, so finishing the
  // page moves straight to the next card instead of showing a loading skeleton.
  useEffect(() => {
    if (loading || done || pendingRefill.current || queue.length === 0) return;
    if (queue.length - idx > REFILL_AHEAD) return;
    const refill: PendingRefill = { page: null };
    pendingRefill.current = refill;
    // Cards still to be shown, or being saved, may come back from the server.
    const exclude = new Set([...queue.slice(idx).map((c) => c.queue_key), ...savingQueueKeys.current]);
    chain.current
      ?.next(exclude)
      .then((page) => {
        refill.page = page;
      })
      .catch(() => undefined);
  }, [queue, idx, loading, done]);

  const card = queue[idx];

  // Time each answer from when its card came on screen, including a card
  // brought back by undo or by a failed save.
  useEffect(() => {
    shownAtRef.current = Date.now();
  }, [idx, card?.queue_key]);

  const restoreReviewState = useCallback(
    async (
      entry: ReviewHistoryEntry,
      mode: "undo" | "redo",
    ): Promise<RestoreResponse | null> => {
      const res = await apiFetch(`/api/cards/${entry.card.id}/review/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cloze_ord: entry.card.cloze_ord ?? 0,
          review_state: mode === "undo" ? entry.previousState : entry.nextState,
          log_id: entry.reviewId,
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
      const responseMs = responseMsSince(shownAtRef.current);
      const gradeMeta = GRADES.find((x) => x.id === g)!;
      const endOfPage = gradedIndex + 1 >= queue.length;
      const prefetched = endOfPage ? (pendingRefill.current?.page ?? null) : null;
      // With the next page already here, carry on without a server round trip;
      // otherwise check the server once this grade is saved.
      const advancingToDone = endOfPage && !prefetched;
      if (endOfPage) pendingRefill.current = null;

      setRevealed(false);
      setStats((s) => ({ ...s, [g]: s[g] + 1 }));
      if (prefetched) {
        setQueue((prev) => [...prev, ...sessionCards(prefetched)]);
        // A new deck's counts are fresh; this deck's were adjusted as cards were graded.
        if (prefetched.deckId !== gradedCard.source_id) {
          updateCounts(prefetched.deckId, () => normalizeQueueCounts(prefetched.queue.counts));
        }
        setIdx(gradedIndex + 1);
      } else if (advancingToDone) {
        // Don't end the session yet — the deck may still have due or learning
        // cards (including ones re-scheduled during this session). Check the
        // server before showing the completion screen.
        setRefilling(true);
      } else {
        setIdx(gradedIndex + 1);
      }

      setError(null);
      posthog.capture("card_reviewed", {
        deck_id: gradedCard.deck_id,
        rating: gradeMeta.rating,
        grade: g,
        card_type: gradedCard.type,
        is_new: gradedCard.is_new,
        online: typeof navigator === "undefined" ? true : navigator.onLine,
      });
      const mutationId = crypto.randomUUID();
      savingQueueKeys.current.add(gradedCard.queue_key);
      try {
        const res = await apiFetch(`/api/cards/${gradedCard.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            rating: gradeMeta.rating,
            cloze_ord: gradedCard.cloze_ord ?? 0,
            client_mutation_id: mutationId,
            answered_at: studyNow().toISOString(),
            raw_answered_at: new Date().toISOString(),
            response_ms: responseMs,
            ...(gradedCard.exam_id ? { context: "exam", exam_id: gradedCard.exam_id } : {}),
          }),
          keepalive: true,
        });
        if (!res.ok) {
          throw new Error((await res.json().catch(() => null))?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as GradeResponse;
        updateCounts(gradedCard.source_id, (prev) =>
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
            reviewId: mutationId,
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
            const inFlight = new Set(savingQueueKeys.current);
            inFlight.delete(gradedCard.queue_key);
            const refreshed = await chain.current?.next(inFlight);
            if (refreshed) {
              setQueue((prev) => [...prev, ...sessionCards(refreshed)]);
              updateCounts(refreshed.deckId, () => normalizeQueueCounts(refreshed.queue.counts));
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
      } finally {
        savingQueueKeys.current.delete(gradedCard.queue_key);
      }
    },
    [card, idx, queue.length, dayStartHour, updateCounts],
  );

  const undoReview = useCallback(async () => {
    if (submitting || undoStack.length === 0) return;
    const entry = undoStack[undoStack.length - 1];
    pendingRefill.current = null;
    setSubmitting(true);
    setError(null);
    try {
      const restored = await restoreReviewState(entry, "undo");
      if (!restored) return;
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [...stack, entry]);
      setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
      updateCounts(entry.card.source_id, (prev) =>
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
  }, [restoreReviewState, submitting, undoStack, dayStartHour, updateCounts]);

  const redoReview = useCallback(async () => {
    if (submitting || redoStack.length === 0) return;
    const entry = redoStack[redoStack.length - 1];
    pendingRefill.current = null;
    setSubmitting(true);
    setError(null);
    try {
      const restored = await restoreReviewState(entry, "redo");
      if (!restored) return;
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack, entry]);
      setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
      updateCounts(entry.card.source_id, (prev) =>
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
  }, [queue.length, restoreReviewState, redoStack, submitting, dayStartHour, updateCounts]);

  const suspendCurrentCard = useCallback(async () => {
    if (!card || submitting) return;
    pendingRefill.current = null;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiFetch(`/api/cards/${card.id}/suspend`, {
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
      updateCounts(suspendedCard.source_id, (prev) =>
        removeCardFromCounts(prev, cardCountBucket(suspendedCard)),
      );
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
  }, [card, idx, submitting, updateCounts]);

  if (loading || refilling) return <StudySkeleton />;

  if (error && queue.length === 0) {
    return (
      <StudyMessage icon="ri-error-warning-line" body={error}>
        <button className="btn btn-primary" onClick={() => void loadQueue()}>
          Retry
        </button>
      </StudyMessage>
    );
  }

  const backHref = examId
    ? `/exams/${examId}`
    : deckId
      ? `/decks/${deckId}`
      : pickedKey
        ? "/decks"
        : "/dashboard";
  const backLabel = examId
    ? "Back to exam"
    : deckId
      ? "Back to deck"
      : pickedKey
        ? "Back to decks"
        : "Back to home";
  const sessionCompleted = stats.again + stats.hard + stats.good + stats.easy;

  if (done) {
    // An exam session ends when nothing more is worth studying yet, not when
    // the cards run out, so it says when the next pass opens.
    const nextPass = examId && examEnd.nextAt ? `next pass ${nextPassLabel(examEnd.nextAt)}` : null;
    const nextReview = examId ? nextPass : nextReviewLabel(undoStack);
    return (
      <StudyComplete
        stats={stats}
        emptyTitle={examId ? "Done for now" : "All caught up"}
        emptyBody={
          examId
            ? nextPass
              ? `Nothing more is worth studying yet. Your ${nextPass}.`
              : "Nothing more is worth studying for this exam right now."
            : "No cards are due for review right now."
        }
        subtitle={[formatSessionLength(startedAt.current), nextReview].filter(Boolean).join(" · ")}
        note={
          examId ? (
            examEnd.skipped > 0 ? (
              <>
                <i className="ri-information-line" aria-hidden />
                <span>
                  {examEnd.skipped.toLocaleString()} more card
                  {examEnd.skipped === 1 ? " is" : "s are"} ready, but today&apos;s study time for
                  this exam is used up. <Link href={backHref}>Exam settings</Link>
                </span>
              </>
            ) : null
          ) : Object.keys(heldBackByDeck).length > 0 ? (
            <HeldBackNote heldBack={heldBackByDeck} deckId={deckId} />
          ) : null
        }
      >
        <button className="btn btn-secondary" onClick={() => router.push(backHref)}>
          {backLabel}
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            setStats(EMPTY_STATS);
            setUndoStack([]);
            setRedoStack([]);
            void loadQueue();
          }}
        >
          {sessionCompleted === 0 || examId ? "Check again" : "Study more"}
        </button>
      </StudyComplete>
    );
  }

  return (
    <>
      {communityDeckIds.map((id) => (
        <DeckSubscriptionSync key={id} deckId={id} />
      ))}
      <StudyCardView
        card={card}
        title={examId ? (examName ?? card.deck_name) : deckId ? (deckTitle ?? card.deck_name) : card.deck_name}
        backHref={backHref}
        backLabel={backLabel}
        mediaDeferred={mediaDeferred}
        revealed={revealed}
        submitting={submitting}
        counts={counts}
        sessionCompleted={sessionCompleted}
        error={error}
        grade={grade}
        undoReview={undoReview}
        redoReview={redoReview}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        setRevealed={setRevealed}
        textScaleIndex={textScaleIndex}
        onTextScaleChange={setTextScale}
        audioAutoplay={audioAutoplay}
        onAudioAutoplayChange={setAudioAutoplay}
        onCardUpdated={(updated) => {
          // By id: the card may be one graded earlier (Explain's Why?), and
          // every cloze sibling of an edited card shares its text.
          setQueue((prev) => prev.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)));
        }}
        onSuspendCard={() => void suspendCurrentCard()}
      />
    </>
  );
}

/** Why new cards are left over, and where to change the limit. */
function HeldBackNote({
  heldBack,
  deckId,
}: {
  heldBack: Record<string, HeldBackNew>;
  deckId?: string;
}) {
  const decks = Object.entries(heldBack);
  const count = decks.reduce((sum, [, entry]) => sum + entry.count, 0);
  const single = decks.length === 1;
  return (
    <>
      <i className="ri-information-line" aria-hidden />
      <span>
        {count.toLocaleString()} new card{count === 1 ? " is" : "s are"} waiting for tomorrow
        because of your daily limit
        {deckId ? ` of ${decks[0][1].limit}` : ""}.{" "}
        <Link href={single ? `/decks/${decks[0][0]}` : "/decks"}>
          {single ? "Deck settings" : "Your decks"}
        </Link>
      </span>
    </>
  );
}

function StudyCardView({
  card,
  title,
  backHref,
  backLabel,
  mediaDeferred,
  revealed,
  submitting,
  counts,
  sessionCompleted,
  error,
  grade,
  undoReview,
  redoReview,
  canUndo,
  canRedo,
  setRevealed,
  textScaleIndex,
  onTextScaleChange,
  audioAutoplay,
  onAudioAutoplayChange,
  onCardUpdated,
  onSuspendCard,
}: {
  card: SessionCard;
  title: string;
  backHref: string;
  backLabel: string;
  mediaDeferred: number;
  revealed: boolean;
  submitting: boolean;
  counts: QueueCounts;
  /** Reviews completed this session; drives the position and progress line. */
  sessionCompleted: number;
  error: string | null;
  grade: (g: Grade) => void;
  undoReview: () => void;
  redoReview: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setRevealed: (v: boolean) => void;
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
  audioAutoplay: boolean;
  onAudioAutoplayChange: (enabled: boolean) => void;
  onCardUpdated: (updated: StudyCardData) => void;
  onSuspendCard: () => void;
}) {
  const [panelMode, setPanelMode] = useStudyPanel(card.queue_key);
  // The card last graded Again, offered back through the Why? pill until the
  // next reveal; and the card the panel shows when that was opened.
  const [missed, setMissed] = useState<SessionCard | null>(null);
  const [panelCard, setPanelCard] = useState<SessionCard | null>(null);
  const [editPrefill, setEditPrefill] = useState<CardFieldFix | null>(null);
  useEffect(() => {
    if (!panelMode) {
      setPanelCard(null);
      setEditPrefill(null);
    }
  }, [panelMode]);
  useEffect(() => {
    if (revealed) setMissed(null);
  }, [revealed]);
  const gradeAndTrack = useCallback(
    (g: Grade) => {
      setMissed(g === "again" ? card : null);
      grade(g);
    },
    [card, grade],
  );
  useAutoplayCardAudio({
    cardKey: card.queue_key,
    questionFields: card.type === "cloze" ? [card.cloze_text] : [card.front],
    answerFields: card.type === "cloze" ? [card.extra] : [card.back, card.extra],
    revealed,
    enabled: audioAutoplay,
  });

  // Expose the current card to the topbar AI assistant.
  useAiContext({
    page: "study-card",
    deckId: card.deck_id,
    card: {
      id: card.id,
      type: card.type,
      front: card.front,
      back: card.back,
      cloze_text: card.cloze_text,
      extra: card.extra,
    },
  });

  useStudyShortcuts({
    panelMode,
    setPanelMode,
    revealed,
    onReveal: () => setRevealed(true),
    onGrade: gradeAndTrack,
    onUndo: () => {
      if (canUndo && !submitting) undoReview();
    },
    onRedo: () => {
      if (canRedo && !submitting) redoReview();
    },
    onSuspend: () => {
      if (!submitting) onSuspendCard();
    },
    textScaleIndex,
    onTextScaleChange,
  });

  // Progress across everything left today (learning + due + new), not just the
  // cards loaded into this session page.
  const remaining = counts.due + counts.new;
  const total = sessionCompleted + remaining;
  const progress = total > 0 ? Math.min(100, (sessionCompleted / total) * 100) : 100;
  const dueRemaining = Math.max(0, counts.due - counts.learning);
  const activeBucket = cardCountBucket(card);

  return (
    <StudyFrame
      header={
        <StudyHeader
          backHref={backHref}
          backLabel={backLabel}
          title={title}
          position={`${Math.min(sessionCompleted + 1, Math.max(total, 1))} of ${Math.max(total, 1)}`}
          panelMode={panelMode}
          onPanelChange={setPanelMode}
          revealed={revealed}
          more={
            <StudyMoreMenu
              onSuspend={onSuspendCard}
              suspendDisabled={submitting}
              textScaleIndex={textScaleIndex}
              onTextScaleChange={onTextScaleChange}
              audioAutoplay={audioAutoplay}
              onAudioAutoplayChange={onAudioAutoplayChange}
            />
          }
        />
      }
      progress={progress}
      notices={
        <>
          <StudyError message={error} />
          {mediaDeferred > 0 ? (
            <p className="dh-note dh-study__notice" role="status">
              <i className="ri-information-line" aria-hidden />
              <span>{mediaDeferred} cards are deferred until their media downloads.</span>
            </p>
          ) : null}
        </>
      }
      card={
        <StudyCardFace
          card={card}
          cardKey={card.queue_key}
          revealed={revealed}
          textScaleIndex={textScaleIndex}
        />
      }
      dock={
        <StudyDock
          revealed={revealed}
          onReveal={() => setRevealed(true)}
          onGrade={gradeAndTrack}
          intervals={card.intervals}
          disabled={submitting}
        />
      }
      aboveDock={
        missed && missed.id !== card.id ? (
          <StudyMissedPill
            answer={missedAnswerLabel(missed)}
            onWhy={() => {
              setPanelCard(missed);
              setMissed(null);
              setPanelMode("explain");
            }}
            onDismiss={() => setMissed(null)}
          />
        ) : null
      }
      meta={
        <StudyMeta
          left={
            <button
              type="button"
              onClick={undoReview}
              disabled={!canUndo || submitting}
              title="Undo (←)"
              aria-label="Undo (←)"
            >
              <i className="ri-arrow-go-back-line" aria-hidden />
              Undo
            </button>
          }
          center={
            <>
              <span aria-current={activeBucket === "learning" ? "true" : undefined}>
                {counts.learning} learning
              </span>
              {" · "}
              <span aria-current={activeBucket === "review" ? "true" : undefined}>
                {dueRemaining} due
              </span>
              {" · "}
              <span aria-current={activeBucket === "new" ? "true" : undefined}>
                {counts.new} new
              </span>
            </>
          }
          right={
            <button
              type="button"
              onClick={redoReview}
              disabled={!canRedo || submitting}
              title="Redo (→)"
              aria-label="Redo (→)"
            >
              Redo
              <i className="ri-arrow-go-forward-line" aria-hidden />
            </button>
          }
        />
      }
      panel={
        panelMode ? (
          <StudyCardPanel
            key={`${panelMode}:${(panelCard ?? card).queue_key}`}
            mode={panelMode}
            card={panelCard ?? card}
            revealed={panelCard ? true : revealed}
            deckId={(panelCard ?? card).deck_id}
            editPrefill={editPrefill}
            onOpenEdit={(fix) => {
              setEditPrefill(fix);
              setPanelMode("edit");
            }}
            onClose={() => setPanelMode(null)}
            onSaved={onCardUpdated}
          />
        ) : null
      }
    />
  );
}
