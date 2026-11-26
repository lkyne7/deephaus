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
  parseStudyQueueOptions,
  responseMsSince,
  studyQueueQuery,
  sumQueueCounts,
  lookOverAnswers,
  summarizeAnswers,
  type ChainedPage,
  type FinishSession,
  type SittingAnswer,
  type StudyQueueChain,
  type StudyQueueOptions,
} from "@deephaus/shared";
import { Image as ExpoImage } from "expo-image";
import * as Linking from "expo-linking";
import { router, type Href } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useDeckActions } from "@/components/deck-actions";
import { LoadError } from "@/components/load-error";
import { ExplainSheet } from "@/components/study/explain-sheet";
import { HintCard } from "@/components/study/hint-card";
import { MissedPill } from "@/components/study/missed-pill";
import { ReviewDock, ReviewDockFooter } from "@/components/study/review-dock";
import { LookOver } from "@/components/study/look-over";
import { SessionFinish } from "@/components/study/session-finish";
import { StudyCardContent } from "@/components/study/study-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { SwipeGradeCard } from "@/components/study/swipe-grade-card";
import { isMenuGroup } from "@/components/ui/menu-sheet";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  ScreenHeader,
  type ScreenHeaderAction,
  type ScreenHeaderMenu,
} from "@/components/ui/screen-header";
import { deckDisplayName, formatDeckName } from "@/lib/deck-name";
import { examReasonLabel, isCramWindow } from "@/lib/exams";
import { haptics } from "@/lib/haptics";
import { useHeaderInset } from "@/lib/header-inset";
import { useStudyLiveActivity } from "@/lib/live-activities/use-study-live-activity";
import { offlineData } from "@/lib/offline-data";
import { posthog } from "@/lib/posthog";
import { openSection } from "@/lib/sections";
import { readStoredStudyAudioAutoplay, writeStoredStudyAudioAutoplay } from "@/lib/study/audio-autoplay";
import { missedAnswerLabel } from "@/lib/study/explain";
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
import { studySitting } from "@/lib/study/sitting";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const PAGE_SIZE = 50;
const FONT_SCALES = [0.85, 1, 1.15, 1.3];
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
  /** As the finish page counts it; redo puts it back. */
  answer: SittingAnswer<SessionCard>;
};

/** A next-page fetch started before the page on screen ran out. */
type PendingRefill = {
  /** Null until the fetch lands, and when no queue has more cards. */
  page: ChainedPage<SessionPage> | null;
};

const NO_OPTIONS: StudyQueueOptions = {};

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
export function StudySession({
  kind,
  id,
  goal,
  options = NO_OPTIONS,
}: {
  kind: StudySessionKind;
  id?: string;
  /** Stop after this many cards (Home's short session), with the rest left for later. */
  goal?: number;
  /** Set when the finish page asked for more than the ordinary day. */
  options?: StudyQueueOptions;
}) {
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
  const [loadError, setLoadError] = useState(false);
  // True totals from each queue (not the 50-card page), keyed by the deck or
  // exam that owns them, so a card's grade adjusts the right one.
  const [countsBySource, setCountsBySource] = useState<Record<string, SessionCounts>>({});
  const [mediaDeferredBySource, setMediaDeferredBySource] = useState<Record<string, number>>({});
  // Single deck: raw, so Rename edits the full "Parent::Leaf" name rather than the leaf.
  const [rawDeckName, setRawDeckName] = useState("");
  // Single exam: the exam, ready cards left out because today's time cap is
  // spent, and when more open.
  const [exam, setExam] = useState<ExamSummaryDto | null>(null);
  /** Predicted recall when the exam's session began. */
  const [examStart, setExamStart] = useState<number | null>(null);
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
  /** Names this session's answers in the sitting. */
  const [sessionKey, setSessionKey] = useState(() => generateUuid());
  // Bumped when a card kept in the sitting is edited, so its new text shows.
  const [, setSittingEdits] = useState(0);
  const [lookOver, setLookOver] = useState<"session" | "sitting" | "deck" | null>(null);
  // A string key, so a new object with the same options doesn't reload the queue.
  const optionsKey = studyQueueQuery(options);
  const finishSession = useMemo<FinishSession>(
    () => ({
      kind,
      id,
      options: parseStudyQueueOptions((key) => new URLSearchParams(optionsKey).get(key)),
    }),
    [id, kind, optionsKey],
  );
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
  // Hint floats above the dock before reveal; the card last graded Again is
  // offered back through the Why? pill; Explain may show that earlier card.
  const [hintOpen, setHintOpen] = useState(false);
  const [missed, setMissed] = useState<SessionCard | null>(null);
  const [explainTarget, setExplainTarget] = useState<SessionCard | null>(null);
  const [suspending, setSuspending] = useState(false);

  const chainRef = useRef<StudyQueueChain<SessionPage> | null>(null);
  const pendingRefillRef = useRef<PendingRefill | null>(null);
  // The last page each queue sent, including empty ones the chain passed over.
  const lastPageRef = useRef<Map<string, SessionPage>>(new Map());
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
    // Opening the deck, adding or browsing cards, or adding an exam would push
    // the app's areas on top of this session; leave the session to do those.
    omit: ["study", "publish", "exam", "open", "create", "browse"],
    onRenamed: (_deck, name) => setRawDeckName(name),
    // The deck's page under this session is gone too, so end on the Decks list.
    onDeleted: () => {
      if (router.canGoBack()) router.back();
      openSection("decks");
    },
  });

  const deckName = formatDeckName(rawDeckName).title;
  const sessionName = combined ? COMBINED_TITLE : examOnly ? (exam?.name ?? "") : deckName;
  const title = sessionName || (examOnly ? "Exam session" : "Study session");
  // A short session stops at its goal; Keep going clears it and carries on.
  const [goalCards, setGoalCards] = useState(goal && goal > 0 ? goal : null);
  const reviewedSoFar = stats.again + stats.hard + stats.good + stats.easy;
  const stoppedAtGoal = goalCards != null && reviewedSoFar >= goalCards && queue[index] != null;
  const current = stoppedAtGoal ? null : (queue[index] ?? null);
  const fontScale = FONT_SCALES[fontIndex];
  const counts = useMemo(() => sumQueueCounts(countsBySource, NO_SESSION_COUNTS), [countsBySource]);
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

  // One event per finished run of cards (queue empty or goal reached), matching
  // the web client: activation and weekly active reviewers count sessions.
  // "Keep going" counts only new reviews; a reloaded queue starts from zero.
  const sessionCapturedCount = useRef(0);
  useEffect(() => {
    if (reviewed === 0) sessionCapturedCount.current = 0;
    if (!sessionComplete || reviewed <= sessionCapturedCount.current) return;
    const cards = reviewed - sessionCapturedCount.current;
    sessionCapturedCount.current = reviewed;
    posthog.capture("study_session_completed", {
      cards_reviewed: cards,
      duration_seconds: sessionStartedAt ? Math.round((Date.now() - sessionStartedAt) / 1000) : null,
      scope: examOnly ? "exam" : combined ? "all" : "deck",
      stopped_at_goal: stoppedAtGoal,
    });
  }, [sessionComplete, reviewed, sessionStartedAt, examOnly, combined, stoppedAtGoal]);
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
      setExamStart((start) => start ?? fetched.exam.snapshot.recall_now);
      setSkipped(fetched.skipped);
      setNextReadyAt(fetched.next_ready_at);
    } else {
      // Only read in a single-deck session.
      setRawDeckName(fetched.deck.name);
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
    setLoadError(false);
    pendingRefillRef.current = null;
    try {
      let sources: StudySource[];
      let seeded: Record<string, SessionCounts> | null = null;
      const sessionOptions = finishSession.options;
      if (combined && (sessionOptions.ahead || sessionOptions.learning)) {
        // Cards brought forward: these decks have nothing due, so the
        // ordinary list of decks with work would leave them out.
        const { decks } = await offlineData.getStudyFinish();
        const forward = decks
          .filter(
            (deck) =>
              !deck.paused &&
              ((sessionOptions.ahead && deck.ahead > 0) ||
                (sessionOptions.learning && deck.returning > 0)),
          )
          .map((deck) => ({
            id: deck.id,
            new: deck.new,
            due:
              deck.due +
              (sessionOptions.ahead ? deck.ahead : 0) +
              (sessionOptions.learning ? deck.returning : 0),
          }))
          .map((deck) => ({ ...deck, waiting: deck.due + deck.new }));
        sources = studySources([], forward);
        seeded = seedSessionCounts([], forward);
      } else if (combined) {
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
        const sent = await offlineData.getStudyQueue(sourceId, {
          ...sessionOptions,
          limit: PAGE_SIZE,
        });
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
      setSessionKey(generateUuid());
      setLookOver(null);
      setSessionStartedAt(cards.length > 0 ? Date.now() : null);
    } catch {
      // Shown in place of the session, so a failure doesn't read as "done".
      setLoadError(true);
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [combined, examOnly, finishSession, id, kind, recordPage, updateCounts]);

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
    setPanelMode(null);
    setHintOpen(false);
  }, [current?.queue_key]);

  useEffect(() => {
    if (revealed) {
      setHintOpen(false);
      setMissed(null);
    }
  }, [revealed]);

  // Time each answer from when its card came on screen, including a card
  // brought back by undo or by a failed save.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, current?.queue_key]);

  // The combined session moves between queues often, so it fetches the next
  // page a few cards before this one runs out: finishing a deck goes straight
  // to the next card instead of a spinner. Cards still to be shown, or still
  // saving, are left out of that page.
  //
  // It waits for a grade, undo or redo to finish saving first. Asked sooner,
  // the queues answer from before that change: after an undo on the last card
  // they say nothing is left, and the counts under the card drop to zero.
  useEffect(() => {
    if (!combined || loading || refilling || busy || pendingRefillRef.current) return;
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
  }, [busy, combined, index, loading, queue, refilling]);

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

  /** False when the grade wasn't taken (nothing on screen, or a save still running). */
  function grade(gradeId: ReviewGrade): boolean {
    if (!current || busy) return false;
    const gradedIndex = index;
    // Guard against double-taps on the same queue slot; the save runs in the
    // background so the next card is on screen before it lands.
    if (inFlightGradesRef.current.has(gradedIndex)) return false;
    inFlightGradesRef.current.add(gradedIndex);
    haptics.medium();
    setBusy(true);
    const gradedCard = current;
    setMissed(gradeId === "again" ? gradedCard : null);
    const responseMs = responseMsSince(shownAt.current);
    const endOfPage = gradedIndex + 1 >= queue.length;
    // With the next page already here, carry on without a round trip;
    // otherwise ask what is left once this grade is saved.
    const prefetched = endOfPage ? (pendingRefillRef.current?.page ?? null) : null;
    if (endOfPage) pendingRefillRef.current = null;
    const advancingToDone = endOfPage && !prefetched;

    // Advance optimistically so the next card is interactive immediately.
    setRevealed(false);
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

    const answer: SittingAnswer<SessionCard> = {
      id: generateUuid(),
      session: sessionKey,
      key: gradedCard.queue_key,
      deckId: (gradedCard as { deck_id?: string }).deck_id ?? gradedCard.source_id,
      deckName: gradedCard.deck_name,
      grade: gradeId,
      isNew: gradedCard.is_new,
      ms: responseMs ?? 0,
      at: Date.now(),
      card: gradedCard,
    };
    studySitting.add(answer);
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
        client_mutation_id: answer.id,
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
            answer,
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
        studySitting.remove(answer.id);
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
    return true;
  }

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
    studySitting.remove(entry.answer.id);
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
        studySitting.add({ ...entry.answer, at: Date.now() });
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
    studySitting.add({ ...entry.answer, at: Date.now() });
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
        studySitting.remove(entry.answer.id);
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

  /** By id: Explain may fix a card graded earlier, and cloze siblings share text. */
  function updateCardText(updated: Partial<StudyCardFields> & { id: string }) {
    const fields = Object.fromEntries(
      Object.entries(updated).filter(
        ([key, value]) => key !== "cloze_ord" && value !== undefined,
      ),
    ) as Partial<SessionCard>;
    studySitting.updateCard(
      (c) => c.id === updated.id,
      (c) => ({ ...c, ...fields }),
    );
    setSittingEdits((count) => count + 1);
    setQueue((q) =>
      q.map((c) =>
        c.id === updated.id
          ? {
              ...c,
              front: updated.front ?? c.front,
              back: updated.back ?? c.back,
              cloze_text: updated.cloze_text ?? c.cloze_text,
              extra: updated.extra ?? c.extra,
            }
          : c,
      ),
    );
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
      // That was the page's last card: carry on with whatever is left.
      if (lastOnPage) void refillQueue(suspendedIndex);
    } catch (e) {
      Alert.alert("Suspend failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSuspending(false);
    }
  }

  // While a page loads, the bar keeps the session's buttons (disabled). An
  // empty bar centres the title, so it would jump between cards.
  const waitingActions: Array<ScreenHeaderAction | ScreenHeaderMenu> = [
    {
      icon: "undo",
      sfIcon: "arrow.uturn.backward",
      label: "Undo",
      disabled: true,
      onPress: () => {},
    },
    {
      id: "assist",
      icon: "sparkles",
      sfIcon: "sparkles",
      label: "Hint",
      disabled: true,
      onPress: () => {},
    },
    {
      type: "menu",
      icon: "more",
      sfIcon: "ellipsis",
      label: "Study actions",
      items: [],
      disabled: true,
    },
  ];

  if (loading || refilling) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        {kind === "deck" && mediaDeferred > 0 ? (
          <Text accessibilityLiveRegion="polite" style={styles.deferredNote}>
            {mediaDeferred} cards are deferred until their media downloads.
          </Text>
        ) : null}
        <ScreenHeader title={title} backFallback={backFallback} actions={waitingActions} />
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
        <LoadError title="Couldn't load this session" onRetry={() => void loadQueue()} />
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

    if (lookOver) {
      return (
        <View style={[styles.root, { paddingTop: headerInset }]}>
          <ScreenHeader
            title="Looking over"
            backFallback={backFallback}
            actions={[
              {
                icon: "close",
                sfIcon: "xmark",
                label: "Stop looking over",
                onPress: () => setLookOver(null),
              },
            ]}
          />
          <LookOver
            misses={summarizeAnswers(
              lookOver === "session"
                ? studySitting.session(sessionKey)
                : lookOverAnswers(studySitting.all(), finishSession, lookOver === "deck" ? "empty" : undefined),
            ).misses}
            fontScale={fontScale}
            onCardUpdated={updateCardText}
            onFinish={() => setLookOver(null)}
          />
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
          actions={[...(undoAtEnd ?? []), ...(kind === "deck" ? [deckMenuAction] : [])]}
        />
        <ProgressBar
          value={stoppedAtGoal ? reviewed / Math.max(1, reviewed + remaining) : 1}
          height={2}
          style={styles.progressLine}
        />
        <SessionFinish
          // A new session, or an answer taken back and given again, is a new ending.
          key={`${sessionKey}:${undoStack.length}`}
          session={finishSession}
          sessionKey={sessionKey}
          name={sessionName}
          remaining={stoppedAtGoal ? remaining : 0}
          exam={examOnly ? exam : null}
          examStart={examStart}
          skipped={skipped}
          nextReadyAt={nextReadyAt}
          mediaDeferred={mediaDeferred}
          backFallback={backFallback}
          onResume={() => setGoalCards(null)}
          onReload={() => void loadQueue()}
          onLookOver={setLookOver}
          onDeckSettings={openDeckSettings}
        />
        {kind === "deck" ? deckActions.sheets : null}
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
          // One button, Hint on the front and Explain on the back. Its id and
          // icon stay put across the flip so the bar keeps its size and the
          // title doesn't shift.
          {
            id: "assist",
            icon: "sparkles",
            sfIcon: "sparkles",
            label: revealed ? "Explain" : "Hint",
            onPress: revealed
              ? () => {
                  setExplainTarget(null);
                  setPanelMode("explain");
                }
              : () => setHintOpen((open) => !open),
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
        <SwipeGradeCard
          cardKey={`${index}:${current.queue_key}`}
          enabled={revealed && !busy}
          intervals={current.intervals}
          onGrade={(gradeId) => grade(gradeId)}
        >
          {cardBody}
        </SwipeGradeCard>
      )}

      {hintOpen && !revealed ? <HintCard card={current} onClose={() => setHintOpen(false)} /> : null}
      {!hintOpen && missed && missed.id !== current.id ? (
        <MissedPill
          answer={missedAnswerLabel(missed)}
          onWhy={() => {
            setExplainTarget(missed);
            setMissed(null);
            setPanelMode("explain");
          }}
          onDismiss={() => setMissed(null)}
        />
      ) : null}

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
        card={explainTarget ?? current}
        visible={panelMode === "explain"}
        onClose={() => setPanelMode(null)}
        onCardFixed={updateCardText}
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
  });
}
