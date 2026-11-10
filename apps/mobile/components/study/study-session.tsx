import {
  applyReviewToCounts,
  cardCountBucket,
  removeCardFromCounts,
  revertReviewFromCounts,
} from "@deephaus/scheduling";
import type { ExamSummaryDto, ReviewCardPayload, ReviewGrade } from "@deephaus/api-client";
import { generateUuid } from "@deephaus/local-db";
import {
  chainStudyQueues,
  extractCardMediaDisplayUrls,
  responseMsSince,
  sumQueueCounts,
  type ChainedPage,
  type StudyQueueChain,
} from "@deephaus/shared";
import { Image as ExpoImage } from "expo-image";
import * as Linking from "expo-linking";
import type { Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useDeckActions } from "@/components/deck-actions";
import { ExplainSheet } from "@/components/study/explain-sheet";
import { ReviewDock, ReviewDockFooter } from "@/components/study/review-dock";
import { SessionEnd } from "@/components/study/session-end";
import { StudyCardContent } from "@/components/study/study-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { isMenuGroup } from "@/components/ui/menu-sheet";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  ScreenHeader,
  type ScreenHeaderAction,
  type ScreenHeaderMenu,
} from "@/components/ui/screen-header";
import { deckDisplayName, formatDeckName } from "@/lib/deck-name";
import { examReasonLabel, formatRecall, formatSessionTime, isCramWindow } from "@/lib/exams";
import { haptics } from "@/lib/haptics";
import { useHeaderInset } from "@/lib/header-inset";
import { useStudyLiveActivity } from "@/lib/live-activities/use-study-live-activity";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import { posthog } from "@/lib/posthog";
import { readStoredStudyAudioAutoplay, writeStoredStudyAudioAutoplay } from "@/lib/study/audio-autoplay";
import {
  NO_SESSION_COUNTS,
  dropStaleCards,
  pageCounts,
  pendingCardKeys,
  readyOnPage,
  seedSessionCounts,
  sessionCards,
  studySources,
  type SessionCard,
  type SessionCounts,
  type SessionPage,
  type StudySource,
} from "@/lib/study/session";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const PAGE_SIZE = 50;
const FONT_SCALES = [0.85, 1, 1.15, 1.3];
const SWIPE_GRADE_THRESHOLD = 72;
const DEFAULT_DAY_START_HOUR = 4;
/** Cards left on the page when the combined session fetches the next one in the background. */
const REFILL_AHEAD = 3;
/** The combined session's name, in its header and on its Live Activity. */
const COMBINED_TITLE = "Today";

const GRADE_RATINGS: Record<ReviewGrade, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

type GradeCounts = Record<ReviewGrade, number>;
const NO_GRADES: GradeCounts = { again: 0, hard: 0, good: 0, easy: 0 };

/** One answered card, with what undo and redo need to put its schedule back. */
type HistoryEntry = {
  cardIndex: number;
  card: SessionCard;
  grade: ReviewGrade;
  previousState: Record<string, unknown> | null;
  reviewId?: string;
  nextState: Record<string, unknown>;
  log: Record<string, unknown>;
};

/** A next-page fetch started before the page on screen ran out. */
type PendingRefill = {
  /** Null until the fetch lands, and when no queue has more cards. */
  page: ChainedPage<SessionPage> | null;
};

function nextStateFields(nextState: Record<string, unknown>): { state: number; due: string } | null {
  const state = Number(nextState.state);
  const due = typeof nextState.due === "string" ? nextState.due : null;
  if (!Number.isFinite(state) || !due) return null;
  return { state, due };
}

function applyRestoreToCard(card: SessionCard, restored: Record<string, unknown>): SessionCard {
  return {
    ...card,
    state: Number(restored.state ?? card.state),
    due: typeof restored.due === "string" ? restored.due : card.due,
    reps: Number(restored.reps ?? card.reps),
    lapses: Number(restored.lapses ?? card.lapses),
    is_new: typeof restored.is_new === "boolean" ? restored.is_new : card.is_new,
    intervals:
      restored.intervals && typeof restored.intervals === "object"
        ? (restored.intervals as ReviewCardPayload["intervals"])
        : card.intervals,
  };
}

function sumValues(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + value, 0);
}

/**
 * What a session studies: one deck's review queue, one exam's, or with "all"
 * everything there is today (each exam with cards ready, then each deck with
 * work), chained into a single session by study-chain in @deephaus/shared.
 */
export type StudySessionKind = "deck" | "exam" | "all";

/**
 * The study session. The three routes under app/study are thin wrappers
 * around it. An exam's cards are ordinary cards: they are graded through the
 * same call, marked as exam study.
 *
 * The single-deck and single-exam sessions keep the differences they had as
 * separate screens (footer, end screen, swipe and suspend on decks only); each
 * is a branch on `kind` below.
 */
export function StudySession({ kind, id }: { kind: StudySessionKind; id?: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const examOnly = kind === "exam";
  const combined = kind === "all";
  const backFallback: Href = examOnly
    ? { pathname: "/exams/[examId]", params: { examId: id ?? "" } }
    : combined
      ? "/home"
      : "/decks";

  const [queue, setQueue] = useState<SessionCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refilling, setRefilling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  // True totals from each queue (not the 50-card page), keyed by the deck or
  // exam that owns them, so a card's grade adjusts the right one.
  const [countsBySource, setCountsBySource] = useState<Record<string, SessionCounts>>({});
  // New cards the daily limit held back; shown on the end screen.
  const [heldBackBySource, setHeldBackBySource] = useState<Record<string, number>>({});
  const [mediaDeferredBySource, setMediaDeferredBySource] = useState<Record<string, number>>({});
  // Single deck: raw, so Rename edits the full "Parent::Leaf" name rather than the leaf.
  const [rawDeckName, setRawDeckName] = useState("");
  // Single exam: the exam, ready cards left out because today's time cap is
  // spent, and when more open.
  const [exam, setExam] = useState<ExamSummaryDto | null>(null);
  const [skipped, setSkipped] = useState(0);
  const [nextReadyAt, setNextReadyAt] = useState<string | null>(null);
  // Single exam: the latest page, where it starts in `queue` and how many
  // cards were ready across the exam when it was fetched. Together they give
  // "left" for the bar.
  const [page, setPage] = useState({ start: 0, ready: 0 });
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_START_HOUR);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  // Per-grade counts and start time feed the end screen and the Live Activity.
  const [stats, setStats] = useState<GradeCounts>(NO_GRADES);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [fontIndex, setFontIndex] = useState(1);
  const [audioAutoplay, setAudioAutoplay] = useState(true);
  useEffect(() => {
    void readStoredStudyAudioAutoplay().then(setAudioAutoplay).catch(() => undefined);
  }, []);
  const toggleAudioAutoplay = useCallback(async () => {
    setAudioAutoplay((enabled) => {
      void writeStoredStudyAudioAutoplay(!enabled).catch(() => undefined);
      return !enabled;
    });
  }, []);
  const [busy, setBusy] = useState(false);
  const [panelMode, setPanelMode] = useState<"edit" | "explain" | null>(null);
  const [suspending, setSuspending] = useState(false);
  const swipeX = useRef(new Animated.Value(0)).current;
  const revealedRef = useRef(revealed);
  const busyRef = useRef(busy);
  revealedRef.current = revealed;
  busyRef.current = busy;

  const chainRef = useRef<StudyQueueChain<SessionPage> | null>(null);
  const pendingRefillRef = useRef<PendingRefill | null>(null);
  // The last page each queue sent, including empty ones the chain passed over.
  const lastPageRef = useRef<Map<string, SessionPage>>(new Map());
  const gradeRef = useRef<(gradeId: ReviewGrade) => void>(() => {});
  const shownAt = useRef(Date.now());
  const inFlightGradesRef = useRef<Set<number>>(new Set());
  // Cards whose grade is still saving: the next page must not bring them back.
  const savingKeysRef = useRef<Set<string>>(new Set());
  // Cards answered this session, with the review count each had before its
  // grade (see dropStaleCards).
  const answeredRef = useRef<Map<string, number>>(new Map());

  const deckActions = useDeckActions({
    // The queue doesn't say whether the deck is published, so a label here
    // could be the wrong way round. Decks keeps that action.
    omit: ["study", "publish", "exam"],
    onRenamed: (_deck, name) => setRawDeckName(name),
    onDeleted: () => goBackOrReplace("/decks"),
  });

  const deckName = formatDeckName(rawDeckName).title;
  const sessionName = combined ? COMBINED_TITLE : examOnly ? (exam?.name ?? "") : deckName;
  const title = sessionName || (examOnly ? "Exam session" : "Study session");
  const current = queue[index] ?? null;
  const fontScale = FONT_SCALES[fontIndex];
  const counts = useMemo(() => sumQueueCounts(countsBySource, NO_SESSION_COUNTS), [countsBySource]);
  const newHeldBack = sumValues(heldBackBySource);
  const mediaDeferred = sumValues(mediaDeferredBySource);
  const reviewed = stats.again + stats.hard + stats.good + stats.easy;
  // Everything left today (learning + due + new), not just the cards loaded
  // into this page. An exam counts down what was ready when its page came.
  const remaining = examOnly
    ? Math.max(queue.length - index, page.ready - (index - page.start), 0)
    : counts.due + counts.new;

  // Dynamic Island / Lock Screen card for the session; tapping it returns here.
  const liveActivityUrl = useMemo(() => {
    if (combined) return Linking.createURL("/study/all");
    if (!id) return "";
    return Linking.createURL(examOnly ? `/study/exam/${id}` : `/study/${id}`);
  }, [combined, examOnly, id]);
  const recallNow = exam?.snapshot.recall_now ?? null;
  const sameDay = exam ? isCramWindow(exam.exam_at) : false;
  const sessionComplete = !loading && !refilling && !current;
  const liveActivityState = useMemo(() => {
    if ((!combined && !id) || sessionStartedAt == null) return null;
    if (sessionComplete && reviewed === 0) return null;
    const session = {
      title: sessionName,
      done: reviewed,
      remaining,
      grades: stats,
      startedAt: sessionStartedAt,
      status: sessionComplete ? ("complete" as const) : ("active" as const),
      url: liveActivityUrl,
    };
    return examOnly
      ? { ...session, kind: "exam" as const, recallNow, sameDay }
      : { ...session, kind: "review" as const };
  }, [
    combined,
    examOnly,
    id,
    liveActivityUrl,
    recallNow,
    remaining,
    reviewed,
    sameDay,
    sessionComplete,
    sessionName,
    sessionStartedAt,
    stats,
  ]);
  useStudyLiveActivity(liveActivityState);
  useAutoplayCardAudio({
    cardKey: current?.queue_key ?? null,
    questionFields: current?.type === "cloze" ? [current.cloze_text] : [current?.front],
    answerFields: current?.type === "cloze" ? [current.extra] : [current?.back, current?.extra],
    revealed,
    enabled: audioAutoplay,
  });

  const updateCounts = useCallback(
    (sourceId: string, update: (counts: SessionCounts) => SessionCounts) => {
      setCountsBySource((prev) => ({
        ...prev,
        [sourceId]: update(prev[sourceId] ?? NO_SESSION_COUNTS),
      }));
    },
    [],
  );

  /** Every page a queue sends, shown or not: what it says about its deck or exam. */
  const recordPage = useCallback((sourceId: string, fetched: SessionPage) => {
    lastPageRef.current.set(sourceId, fetched);
    setMediaDeferredBySource((prev) => ({
      ...prev,
      [sourceId]: fetched.offline_media_deferred ?? 0,
    }));
    if ("exam" in fetched) {
      // Only read in a single-exam session, where there is one exam to name.
      setExam(fetched.exam);
      setSkipped(fetched.skipped);
      setNextReadyAt(fetched.next_ready_at);
    } else {
      // Only read in a single-deck session.
      setRawDeckName(fetched.deck.name);
      setHeldBackBySource((prev) => ({
        ...prev,
        [sourceId]: fetched.counts.new_held_back ?? 0,
      }));
    }
    // Refresh the true totals even when the queue comes back empty. A page
    // with cards has its counts taken when it is shown, because one fetched
    // ahead still counts cards that are on screen.
    if (fetched.cards.length + fetched.dropped === 0) {
      setCountsBySource((prev) => ({ ...prev, [sourceId]: pageCounts(fetched.counts) }));
    }
  }, []);

  const loadQueue = useCallback(async () => {
    if (!combined && !id) return;
    setLoading(true);
    setLoadError(null);
    pendingRefillRef.current = null;
    try {
      let sources: StudySource[];
      let seeded: Record<string, SessionCounts> | null = null;
      if (combined) {
        const [decks, exams] = await Promise.all([
          offlineData.listDecks().then((result) => result.decks),
          // A failed exam fetch is no exams: the decks can still be studied.
          offlineData
            .listExams()
            .then((result) => result.exams)
            .catch(() => []),
        ]);
        sources = studySources(exams, decks);
        seeded = seedSessionCounts(exams, decks);
      } else {
        sources = [{ id: id ?? "", kind: examOnly ? "exam" : "deck" }];
      }
      const kinds = new Map(sources.map((source) => [source.id, source.kind]));

      inFlightGradesRef.current.clear();
      savingKeysRef.current.clear();
      answeredRef.current.clear();
      lastPageRef.current.clear();
      if (seeded) {
        setCountsBySource(seeded);
        setHeldBackBySource({});
        setMediaDeferredBySource({});
      }

      // A deck's own session shows whatever its queue sends, as it always has.
      const fresh = <C extends { queue_key: string; reps: number }>(cards: C[]): C[] =>
        kind === "deck" ? cards : dropStaleCards(cards, answeredRef.current);
      const fetchPage = async (sourceId: string): Promise<SessionPage> => {
        if (kinds.get(sourceId) === "exam") {
          const sent = await offlineData.getExamQueue(sourceId, { limit: PAGE_SIZE });
          const cards = fresh(sent.cards);
          return { ...sent, cards, dropped: sent.cards.length - cards.length };
        }
        const sent = await offlineData.getStudyQueue(sourceId, { limit: PAGE_SIZE });
        const cards = fresh(sent.cards);
        return { ...sent, cards, dropped: sent.cards.length - cards.length };
      };

      const chain = chainStudyQueues<ReviewCardPayload, SessionPage>(
        sources.map((source) => source.id),
        fetchPage,
        recordPage,
      );
      chainRef.current = chain;
      const first = await chain.next(new Set());
      const cards = first ? sessionCards(first) : [];
      // With nothing to show, a single queue's empty page still has its counts.
      const shown = first?.queue ?? (id ? lastPageRef.current.get(id) : undefined);

      if (first) updateCounts(first.deckId, () => pageCounts(first.queue.counts));
      setQueue(cards);
      setPage({ start: 0, ready: shown ? readyOnPage(shown) : 0 });
      setDayStartHour(shown?.day_start_hour ?? DEFAULT_DAY_START_HOUR);
      setIndex(0);
      setRevealed(false);
      setUndoStack([]);
      setRedoStack([]);
      setStats(NO_GRADES);
      setSessionStartedAt(cards.length > 0 ? Date.now() : null);
    } catch (e) {
      if (kind === "deck") {
        Alert.alert("Study failed", e instanceof Error ? e.message : "Could not load queue");
      } else {
        setLoadError(e instanceof Error ? e.message : "Could not load this session.");
        setQueue([]);
      }
    } finally {
      setLoading(false);
    }
  }, [combined, examOnly, id, kind, recordPage, updateCounts]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Warm expo-image's disk cache for the whole session's media so cards render
  // instantly on flip and stay available offline.
  useEffect(() => {
    const urls = new Set<string>();
    for (const card of queue) {
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
    if (urls.size > 0) {
      void ExpoImage.prefetch([...urls], { cachePolicy: "disk" }).catch(() => {});
    }
  }, [queue]);

  useEffect(() => {
    swipeX.setValue(0);
  }, [index, swipeX]);

  useEffect(() => {
    setPanelMode(null);
  }, [current?.queue_key]);

  // Time each answer from when its card came on screen, including a card
  // brought back by undo or by a failed save.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, current?.queue_key]);

  // The combined session moves between queues often, so it fetches the next
  // page a few cards before this one runs out: finishing a deck goes straight
  // to the next card instead of a spinner. Cards still to be shown, or still
  // saving, are left out of that page.
  useEffect(() => {
    if (!combined || loading || refilling || pendingRefillRef.current) return;
    if (index >= queue.length || queue.length - index > REFILL_AHEAD) return;
    const chain = chainRef.current;
    if (!chain) return;
    const refill: PendingRefill = { page: null };
    pendingRefillRef.current = refill;
    chain
      .next(pendingCardKeys(queue, index, savingKeysRef.current))
      .then((next) => {
        refill.page = next;
      })
      .catch(() => undefined);
  }, [combined, index, loading, queue, refilling]);

  /** A finished page: ask what is ready now and carry on from `fromIndex`. */
  const refillQueue = useCallback(
    async (fromIndex: number) => {
      const chain = chainRef.current;
      if (!chain) return false;
      setRefilling(true);
      try {
        // Nothing is left on screen by now, so only grades still saving are
        // kept out. A card graded Again keeps its queue_key when it comes due
        // again, and must be able to re-enter the session.
        const next = await chain.next(pendingCardKeys([], 0, savingKeysRef.current));
        const shown = next?.queue ?? (id ? lastPageRef.current.get(id) : undefined);
        setPage({ start: fromIndex, ready: shown ? readyOnPage(shown) : 0 });
        if (!next) return false;
        const cards = sessionCards(next);
        updateCounts(next.deckId, () => pageCounts(next.queue.counts));
        setQueue((prev) => [...prev.slice(0, fromIndex), ...cards]);
        setIndex(fromIndex);
        return true;
      } catch {
        // The grade itself was saved; the end screen offers another look.
        return false;
      } finally {
        setRefilling(false);
      }
    },
    [id, updateCounts],
  );

  function grade(gradeId: ReviewGrade) {
    if (!current || busy) return;
    const gradedIndex = index;
    // Guard against double-taps on the same queue slot; the save runs in the
    // background so the next card is on screen before it lands.
    if (inFlightGradesRef.current.has(gradedIndex)) return;
    inFlightGradesRef.current.add(gradedIndex);
    haptics.medium();
    setBusy(true);
    const gradedCard = current;
    const responseMs = responseMsSince(shownAt.current);
    const endOfPage = gradedIndex + 1 >= queue.length;
    // With the next page already here, carry on without a round trip;
    // otherwise ask what is left once this grade is saved.
    const prefetched = endOfPage ? (pendingRefillRef.current?.page ?? null) : null;
    if (endOfPage) pendingRefillRef.current = null;
    const advancingToDone = endOfPage && !prefetched;

    // Advance optimistically so the next card is interactive immediately.
    setRevealed(false);
    swipeX.setValue(0);
    setStats((s) => ({ ...s, [gradeId]: s[gradeId] + 1 }));
    answeredRef.current.set(gradedCard.queue_key, gradedCard.reps);
    savingKeysRef.current.add(gradedCard.queue_key);
    if (prefetched) {
      const cards = sessionCards(prefetched);
      setQueue((prev) => [...prev, ...cards]);
      // A new queue's counts are fresh; this one's were adjusted as cards were graded.
      if (prefetched.deckId !== gradedCard.source_id) {
        updateCounts(prefetched.deckId, () => pageCounts(prefetched.queue.counts));
      }
      setIndex(gradedIndex + 1);
    } else if (advancingToDone) {
      // Don't flash the end screen: more may be ready past this page, and a
      // card rated Again comes back for its next step. Show the refill
      // spinner until the queue confirms what's left.
      setRefilling(true);
      setIndex(queue.length);
    } else {
      setIndex(gradedIndex + 1);
    }

    posthog.capture("card_reviewed", {
      ...(gradedCard.exam_id
        ? { exam_id: gradedCard.exam_id, context: "exam" }
        : { deck_id: gradedCard.source_id }),
      grade: gradeId,
      card_type: gradedCard.type,
      is_new: gradedCard.is_new,
    });
    offlineData
      .submitReview(gradedCard.id, {
        rating: GRADE_RATINGS[gradeId],
        cloze_ord: gradedCard.cloze_ord ?? undefined,
        // A card an exam's queue served counts towards that exam.
        ...(gradedCard.exam_id ? { context: "exam" as const, exam_id: gradedCard.exam_id } : {}),
        response_ms: responseMs,
        client_mutation_id: generateUuid(),
      })
      .then(async (response) => {
        savingKeysRef.current.delete(gradedCard.queue_key);
        const nextState = (response.next_state as Record<string, unknown>) ?? {};
        // Remove the graded card's bucket, then re-add it if the new schedule
        // keeps it due today ("Again").
        updateCounts(gradedCard.source_id, (c) =>
          applyReviewToCounts(
            c,
            { is_new: gradedCard.is_new, state: gradedCard.state },
            nextStateFields(nextState),
            dayStartHour,
          ),
        );
        setUndoStack((stack) => [
          ...stack,
          {
            cardIndex: gradedIndex,
            card: gradedCard,
            grade: gradeId,
            previousState: (response.previous_state as Record<string, unknown> | null) ?? null,
            reviewId: typeof response.review_id === "string" ? response.review_id : undefined,
            nextState,
            log: (response.log as Record<string, unknown>) ?? {},
          },
        ]);
        setRedoStack([]);
        if (!examOnly) {
          const updatedIntervals = (response.intervals ??
            gradedCard.intervals) as ReviewCardPayload["intervals"];
          setQueue((q) => {
            const next = [...q];
            next[gradedIndex] = { ...gradedCard, intervals: updatedIntervals };
            return next;
          });
        }
        if (advancingToDone) {
          await refillQueue(gradedIndex + 1);
        }
      })
      .catch((e) => {
        // Roll back the optimistic advance if the save failed.
        savingKeysRef.current.delete(gradedCard.queue_key);
        answeredRef.current.delete(gradedCard.queue_key);
        setStats((s) => ({ ...s, [gradeId]: Math.max(0, s[gradeId] - 1) }));
        setRefilling(false);
        setIndex(gradedIndex);
        setRevealed(true);
        Alert.alert("Grade failed", e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        inFlightGradesRef.current.delete(gradedIndex);
        setBusy(false);
      });
  }

  gradeRef.current = grade;

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gesture) =>
          revealedRef.current &&
          !busyRef.current &&
          Math.abs(gesture.dx) > 10 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
        onPanResponderMove: (_, gesture) => {
          if (!revealedRef.current || busyRef.current) return;
          swipeX.setValue(gesture.dx);
        },
        onPanResponderRelease: (_, gesture) => {
          if (!revealedRef.current || busyRef.current) {
            Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
            return;
          }
          if (gesture.dx > SWIPE_GRADE_THRESHOLD) {
            Animated.timing(swipeX, {
              toValue: 420,
              duration: 140,
              useNativeDriver: true,
            }).start(() => {
              swipeX.setValue(0);
              void gradeRef.current("good");
            });
            return;
          }
          if (gesture.dx < -SWIPE_GRADE_THRESHOLD) {
            Animated.timing(swipeX, {
              toValue: -420,
              duration: 140,
              useNativeDriver: true,
            }).start(() => {
              swipeX.setValue(0);
              void gradeRef.current("again");
            });
            return;
          }
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        },
        onPanResponderTerminate: () => {
          Animated.spring(swipeX, { toValue: 0, useNativeDriver: true, friction: 8 }).start();
        },
      }),
    [swipeX],
  );

  const cardRotate = swipeX.interpolate({
    inputRange: [-180, 0, 180],
    outputRange: ["-4deg", "0deg", "4deg"],
    extrapolate: "clamp",
  });
  const againTintOpacity = swipeX.interpolate({
    inputRange: [-120, -36, 0],
    outputRange: [0.28, 0.1, 0],
    extrapolate: "clamp",
  });
  const goodTintOpacity = swipeX.interpolate({
    inputRange: [0, 36, 120],
    outputRange: [0, 0.1, 0.28],
    extrapolate: "clamp",
  });

  // Exam cards are ordinary cards, so undo and redo use one restore path. The
  // review log keeps its exam context either way.
  function undo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || busy) return;
    haptics.light();

    // Apply optimistically so the reviewer doesn't freeze on the network round-trip.
    setBusy(true);
    // A page fetched ahead was chosen with this card answered.
    pendingRefillRef.current = null;
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
    const before = { is_new: entry.card.is_new, state: entry.card.state };
    const after = nextStateFields(entry.nextState);
    updateCounts(entry.card.source_id, (c) => revertReviewFromCounts(c, before, after, dayStartHour));
    answeredRef.current.delete(entry.card.queue_key);
    setIndex(entry.cardIndex);
    setRevealed(true);

    offlineData
      .restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.previousState,
        log_id: entry.reviewId,
        log_action: "delete_latest",
      })
      .then((restored) => {
        setQueue((cards) =>
          cards.map((card, cardIndex) =>
            cardIndex === entry.cardIndex ? applyRestoreToCard(card, restored) : card,
          ),
        );
      })
      .catch((e) => {
        // Roll back the optimistic state if the restore is rejected.
        setUndoStack((stack) => [...stack, entry]);
        setRedoStack((stack) => stack.slice(0, -1));
        setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
        updateCounts(entry.card.source_id, (c) =>
          applyReviewToCounts(c, before, after, dayStartHour),
        );
        answeredRef.current.set(entry.card.queue_key, entry.card.reps);
        setIndex(Math.min(entry.cardIndex + 1, queue.length));
        setRevealed(false);
        Alert.alert("Undo failed", e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => setBusy(false));
  }

  function redo() {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || busy) return;
    haptics.light();

    setBusy(true);
    pendingRefillRef.current = null;
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
    const before = { is_new: entry.card.is_new, state: entry.card.state };
    const after = nextStateFields(entry.nextState);
    updateCounts(entry.card.source_id, (c) => applyReviewToCounts(c, before, after, dayStartHour));
    answeredRef.current.set(entry.card.queue_key, entry.card.reps);
    setRevealed(false);
    const advancingToDone = entry.cardIndex + 1 >= queue.length;
    if (advancingToDone) {
      setRefilling(true);
      setIndex(queue.length);
    } else {
      setIndex(entry.cardIndex + 1);
    }

    offlineData
      .restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.nextState,
        log_id: entry.reviewId,
        log_action: "insert",
        log: entry.log,
      })
      .then(async (restored) => {
        setQueue((cards) =>
          cards.map((card, cardIndex) =>
            cardIndex === entry.cardIndex ? applyRestoreToCard(card, restored) : card,
          ),
        );
        if (advancingToDone) {
          await refillQueue(entry.cardIndex + 1);
        }
      })
      .catch((e) => {
        setRefilling(false);
        setRedoStack((stack) => [...stack, entry]);
        setUndoStack((stack) => stack.slice(0, -1));
        setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
        updateCounts(entry.card.source_id, (c) =>
          revertReviewFromCounts(c, before, after, dayStartHour),
        );
        answeredRef.current.delete(entry.card.queue_key);
        setIndex(entry.cardIndex);
        setRevealed(true);
        Alert.alert("Redo failed", e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => setBusy(false));
  }

  function revealAnswer() {
    if (!revealed && !busy) {
      haptics.selection();
      setRevealed(true);
    }
  }

  function updateCurrentCard(updated: StudyCardFields) {
    setQueue((q) =>
      q.map((c, i) =>
        i === index
          ? {
              ...c,
              front: updated.front,
              back: updated.back,
              cloze_text: updated.cloze_text,
              extra: updated.extra,
            }
          : c,
      ),
    );
  }

  async function suspendCurrentCard() {
    if (!current || busy || suspending) return;
    setSuspending(true);
    pendingRefillRef.current = null;
    const suspendedIndex = index;
    const suspendedCard = current;
    const lastOnPage = suspendedIndex >= queue.length - 1;
    try {
      await offlineData.suspendCard(suspendedCard.id, true);
      setRevealed(false);
      updateCounts(suspendedCard.source_id, (c) =>
        removeCardFromCounts(c, cardCountBucket(suspendedCard)),
      );
      setQueue((q) => {
        const next = q.filter((_, i) => i !== suspendedIndex);
        // `index` must point at a valid card or past the end (complete). Clamping
        // to `length - 1` after deleting the final card renders a null card.
        if (next.length === 0 || suspendedIndex >= next.length) {
          setIndex(next.length);
        } else {
          setIndex(suspendedIndex);
        }
        return next;
      });
      // The combined session has other queues to go on to. A deck's own
      // session ends here, as it always has; Study more carries on.
      if (combined && lastOnPage) void refillQueue(suspendedIndex);
    } catch (e) {
      Alert.alert("Suspend failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSuspending(false);
    }
  }

  if (loading || refilling) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        {kind === "deck" && mediaDeferred > 0 ? (
          <Text accessibilityLiveRegion="polite" style={styles.deferredNote}>
            {mediaDeferred} cards are deferred until their media downloads.
          </Text>
        ) : null}
        <ScreenHeader title={title} backFallback={backFallback} />
        <SafeAreaView style={styles.center} edges={["bottom"]}>
          <ActivityIndicator color={colors.accent} />
        </SafeAreaView>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader title={title} backFallback={backFallback} />
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="gray" size="lg" />
          <Text style={styles.stateBody}>{loadError}</Text>
          <Button
            variant="secondary"
            size="md"
            label="Try again"
            onPress={() => void loadQueue()}
            style={{ marginTop: 12 }}
          />
        </View>
      </View>
    );
  }

  // Deck actions belong to a single deck's session.
  const deckMenu =
    kind === "deck" && id
      ? deckActions.entriesFor({
          id,
          title: rawDeckName,
          // The queue counts what's due, not the deck's size. Above zero keeps Export on.
          cardCount: 1,
        })
      : [];
  const deckMenuAction: ScreenHeaderMenu = {
    type: "menu",
    icon: "more",
    sfIcon: "ellipsis",
    label: "Deck actions",
    items: deckMenu,
  };
  const undoAction: ScreenHeaderAction = {
    icon: "undo",
    sfIcon: "arrow.uturn.backward",
    label: "Undo",
    disabled: undoStack.length === 0,
    onPress: () => undo(),
  };

  if (!current) {
    const undoAtEnd = undoStack.length > 0 ? [undoAction] : undefined;

    if (examOnly) {
      return (
        <View style={[styles.root, { paddingTop: headerInset }]}>
          <ScreenHeader title={title} backFallback={backFallback} actions={undoAtEnd} />
          <SafeAreaView style={styles.completeRoot} edges={["bottom"]}>
            <ExamSessionDone
              exam={exam}
              stats={stats}
              startedAt={sessionStartedAt}
              skipped={skipped}
              nextReadyAt={nextReadyAt}
              mediaDeferred={mediaDeferred}
              onCheckAgain={() => void loadQueue()}
              onDone={() => goBackOrReplace(backFallback)}
            />
          </SafeAreaView>
        </View>
      );
    }

    const openDeckSettings = deckMenu
      .flatMap((entry) => (isMenuGroup(entry) ? entry.items : [entry]))
      .find((item) => item.label === "Deck settings")?.onPress;

    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title={title}
          backFallback={backFallback}
          actions={combined ? undoAtEnd : [deckMenuAction]}
        />
        <SessionComplete
          name={sessionName}
          stats={stats}
          startedAt={sessionStartedAt}
          newHeldBack={newHeldBack}
          // A deck's session says this while it loads; here it would be lost.
          mediaDeferred={combined ? mediaDeferred : 0}
          onAgain={() => void loadQueue()}
          onDone={() => goBackOrReplace(backFallback)}
          onOpenDeckSettings={openDeckSettings}
        />
        {combined ? null : deckActions.sheets}
      </View>
    );
  }

  const progressTotal = reviewed + remaining;
  const progress = progressTotal <= 0 ? 1 : Math.min(1, reviewed / progressTotal);
  const activeBucket = cardCountBucket(current);
  const dueRemaining = Math.max(0, counts.due - counts.learning);
  const reason = current.reason ? examReasonLabel(current.reason) : "";
  // Where the card comes from. A deck's own session has its name in the header.
  const cardSource = examOnly
    ? [reason, current.deck_name ? deckDisplayName(current.deck_name) : ""]
    : combined
      ? current.exam_name
        ? [current.exam_name, reason]
        : [deckDisplayName(current.deck_name)]
      : [];
  const cardSourceLine = cardSource.filter(Boolean).join(" · ");

  const cardBody = (
    <Pressable style={styles.cardBody} onPress={revealAnswer} disabled={revealed || busy}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={cardSourceLine ? styles.questionWrapLabelled : styles.questionWrap}
        showsVerticalScrollIndicator={false}
      >
        {cardSourceLine ? (
          <Text style={styles.cardSource} numberOfLines={1}>
            {cardSourceLine}
          </Text>
        ) : null}
        <StudyCardContent card={current} revealed={revealed} fontScale={fontScale} />
      </ScrollView>
    </Pressable>
  );

  return (
    <View style={[styles.root, { paddingTop: headerInset }]}>
      <ScreenHeader
        title={title}
        backFallback={backFallback}
        actions={[
          undoAction,
          {
            icon: "sparkles",
            sfIcon: "sparkles",
            label: "AI explainer",
            onPress: () => setPanelMode("explain"),
          },
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis",
            label: "Study actions",
            items: [
              {
                items: [
                  {
                    label: "Redo",
                    sfIcon: "arrow.uturn.forward",
                    disabled: redoStack.length === 0,
                    onPress: () => redo(),
                  },
                  {
                    label: "Edit card",
                    sfIcon: "pencil",
                    onPress: () => setPanelMode("edit"),
                  },
                  // An exam's own session has never offered suspend.
                  ...(examOnly
                    ? []
                    : [
                        {
                          label: suspending ? "Suspending…" : "Suspend card",
                          sfIcon: "pause.circle" as const,
                          disabled: busy || suspending,
                          onPress: () => void suspendCurrentCard(),
                        },
                      ]),
                ],
              },
              {
                items: [
                  {
                    label: "Smaller text",
                    sfIcon: "textformat.size.smaller",
                    disabled: fontIndex <= 0,
                    onPress: () => setFontIndex((i) => Math.max(0, i - 1)),
                  },
                  {
                    label: "Larger text",
                    sfIcon: "textformat.size.larger",
                    disabled: fontIndex >= FONT_SCALES.length - 1,
                    onPress: () =>
                      setFontIndex((i) => Math.min(FONT_SCALES.length - 1, i + 1)),
                  },
                  {
                    label: "Auto-play audio",
                    sfIcon: "speaker.wave.2",
                    selected: audioAutoplay,
                    onPress: () => void toggleAudioAutoplay(),
                  },
                ],
              },
              ...deckMenu,
            ],
          },
        ]}
      />

      <ProgressBar value={progress} height={2} style={styles.progressLine} />

      {examOnly ? (
        cardBody
      ) : (
        // A swipe across the card grades it: right for Good, left for Again.
        <View style={styles.cardArea}>
          <Animated.View
            pointerEvents="none"
            style={[styles.swipeTint, styles.swipeTintAgain, { opacity: againTintOpacity }]}
          />
          <Animated.View
            pointerEvents="none"
            style={[styles.swipeTint, styles.swipeTintGood, { opacity: goodTintOpacity }]}
          />
          <Animated.View
            style={{
              flex: 1,
              transform: [{ translateX: swipeX }, { rotate: cardRotate }],
            }}
            {...panResponder.panHandlers}
          >
            {cardBody}
          </Animated.View>
        </View>
      )}

      <ReviewDock
        revealed={revealed}
        disabled={busy}
        intervals={current.intervals}
        onReveal={revealAnswer}
        onGrade={(gradeId) => grade(gradeId)}
        bottomInset={insets.bottom}
        footer={
          <ReviewDockFooter>
            {examOnly ? (
              <Text style={styles.statusCounts} numberOfLines={1}>
                {reviewed} done · {remaining} left
              </Text>
            ) : (
              <Text
                accessibilityLabel={`${counts.learning} learning, ${dueRemaining} due, ${counts.new} new. This card is ${activeBucket === "review" ? "due" : activeBucket}.`}
                style={styles.statusCounts}
                numberOfLines={1}
              >
                <Text style={activeBucket === "learning" ? styles.statusActive : undefined}>
                  {counts.learning} learning
                </Text>
                {" · "}
                <Text style={activeBucket === "review" ? styles.statusActive : undefined}>
                  {dueRemaining} due
                </Text>
                {" · "}
                <Text style={activeBucket === "new" ? styles.statusActive : undefined}>
                  {counts.new} new
                </Text>
              </Text>
            )}
          </ReviewDockFooter>
        }
      />

      <ExplainSheet
        cardId={current.id}
        visible={panelMode === "explain"}
        onClose={() => setPanelMode(null)}
      />
      {panelMode === "edit" ? (
        <StudyCardPanel
          card={current}
          onClose={() => setPanelMode(null)}
          onSaved={(updated) => {
            updateCurrentCard(updated);
          }}
        />
      ) : null}
      {kind === "deck" ? deckActions.sheets : null}
    </View>
  );
}

/** A deck's session, or the combined one, with nothing left: what was done. */
function SessionComplete({
  name,
  stats,
  startedAt,
  newHeldBack,
  mediaDeferred,
  onAgain,
  onDone,
  onOpenDeckSettings,
}: {
  name: string;
  stats: GradeCounts;
  startedAt: number | null;
  newHeldBack: number;
  mediaDeferred: number;
  onAgain: () => void;
  onDone: () => void;
  onOpenDeckSettings?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const total = stats.again + stats.hard + stats.good + stats.easy;
  const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60_000)) : null;

  const heldBackNote =
    newHeldBack > 0 ? (
      <View style={styles.heldBackRow}>
        <Icon name="info" size={16} color={colors.due} />
        <Text style={styles.heldBackText}>
          {newHeldBack} new card{newHeldBack === 1 ? " is" : "s are"} waiting for tomorrow because
          of your daily limit.{" "}
          {onOpenDeckSettings ? (
            <Text accessibilityRole="link" onPress={onOpenDeckSettings} style={styles.heldBackLink}>
              Deck settings
            </Text>
          ) : null}
        </Text>
      </View>
    ) : null;
  const mediaNote =
    mediaDeferred > 0 ? (
      <Text style={styles.noteText}>
        {mediaDeferred} card{mediaDeferred === 1 ? " is" : "s are"} waiting for media to download.
      </Text>
    ) : null;

  return (
    <SafeAreaView style={styles.completeRoot} edges={["bottom"]}>
      <SessionEnd
        title={
          total > 0
            ? `That's ${total} card${total === 1 ? "" : "s"} done`
            : "Nothing to review right now"
        }
        subtitle={
          total > 0 && minutes ? `${name} · ${minutes} minute${minutes === 1 ? "" : "s"}` : name
        }
        grades={stats}
        note={
          heldBackNote && mediaNote ? (
            <View style={styles.notes}>
              {heldBackNote}
              {mediaNote}
            </View>
          ) : (
            (heldBackNote ?? mediaNote)
          )
        }
        actions={
          <>
            <Button variant="primary" size="lg" label="Study more" fullWidth onPress={onAgain} />
            <Button variant="secondary" size="lg" label="Done" fullWidth onPress={onDone} />
          </>
        }
      />
    </SafeAreaView>
  );
}

/** Nothing is ready for the exam: what the session came to, and when the next cards open. */
function ExamSessionDone({
  exam,
  stats,
  startedAt,
  skipped,
  nextReadyAt,
  mediaDeferred,
  onCheckAgain,
  onDone,
}: {
  exam: ExamSummaryDto | null;
  stats: GradeCounts;
  startedAt: number | null;
  skipped: number;
  nextReadyAt: string | null;
  mediaDeferred: number;
  onCheckAgain: () => void;
  onDone: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const total = stats.again + stats.hard + stats.good + stats.easy;
  const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60_000)) : null;
  const over = exam != null && exam.status !== "active";

  const now = Date.now();
  // The queue knows when the next card comes due today; otherwise fall back
  // to when the exam's next session is planned.
  const nextAt = [nextReadyAt, exam?.next_session_at ?? null].find(
    (at): at is string => at != null && Date.parse(at) > now + 60_000,
  );

  const parts: string[] = [];
  if (total > 0) {
    parts.push(`${total} card${total === 1 ? "" : "s"}`);
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? "" : "s"}`);
  } else if (exam?.name) {
    parts.push(exam.name);
  }
  if (exam && exam.snapshot.total > 0) {
    parts.push(`${formatRecall(exam.snapshot.recall_now)} if the exam were now`);
  }

  const notes: string[] = [];
  if (over) {
    notes.push(
      exam.status === "archived"
        ? "This exam is archived, so it has no sessions."
        : "This exam's date has passed, so it has no more sessions.",
    );
  } else {
    if (nextAt) notes.push(`The next cards open ${formatSessionTime(nextAt, now)}.`);
    if (skipped > 0) {
      notes.push(
        `${skipped} card${skipped === 1 ? " is" : "s are"} waiting because today's study time is used up.`,
      );
    }
    if (mediaDeferred > 0) {
      notes.push(
        `${mediaDeferred} card${mediaDeferred === 1 ? " is" : "s are"} waiting for media to download.`,
      );
    }
  }

  return (
    <SessionEnd
      title={over ? "No session to study" : "Done for now"}
      subtitle={parts.join(" · ") || undefined}
      grades={stats}
      note={
        notes.length > 0 ? (
          <View style={styles.notes}>
            {notes.map((note) => (
              <Text key={note} style={styles.noteText}>
                {note}
              </Text>
            ))}
          </View>
        ) : null
      }
      actions={
        <>
          <Button variant="primary" size="lg" label="Done" fullWidth onPress={onDone} />
          {over ? null : (
            <Button
              variant="secondary"
              size="lg"
              label="Check again"
              fullWidth
              onPress={onCheckAgain}
            />
          )}
        </>
      }
    />
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, backgroundColor: colors.bgCanvas },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.bgCanvas,
      padding: 24,
    },
    stateBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 12,
    },
    deferredNote: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgSecondary,
      padding: 12,
    },
    progressLine: {
      borderRadius: 0,
    },
    cardArea: {
      flex: 1,
      minHeight: 0,
      position: "relative",
    },
    swipeTint: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    swipeTintAgain: {
      backgroundColor: colors.gradeAgain,
    },
    swipeTintGood: {
      backgroundColor: colors.gradeGood,
    },
    cardBody: {
      flex: 1,
      minHeight: 0,
    },
    questionWrap: {
      flexGrow: 1,
      paddingTop: 44,
      paddingBottom: 32,
      paddingHorizontal: 24,
    },
    // With the line saying where the card comes from above it.
    questionWrapLabelled: {
      flexGrow: 1,
      paddingTop: 28,
      paddingBottom: 32,
      paddingHorizontal: 24,
    },
    cardSource: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
      color: colors.fgTertiary,
      marginBottom: 20,
    },
    statusCounts: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    statusActive: {
      color: colors.fgPrimary,
      fontWeight: "500",
    },
    completeRoot: { flex: 1, backgroundColor: colors.bgCanvas },
    heldBackRow: {
      flexDirection: "row",
      gap: 8,
    },
    heldBackText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 19,
      color: colors.fgSecondary,
    },
    heldBackLink: {
      color: colors.fgSecondary,
      textDecorationLine: "underline",
    },
    notes: { gap: 6 },
    noteText: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.fgSecondary,
      textAlign: "center",
    },
  });
}
