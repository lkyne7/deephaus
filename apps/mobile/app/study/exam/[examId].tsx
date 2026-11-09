import type {
  ExamQueueCard,
  ExamQueueResponse,
  ExamSummaryDto,
  ReviewGrade,
} from "@deephaus/api-client";
import { generateUuid } from "@deephaus/local-db";
import { extractCardMediaDisplayUrls, responseMsSince } from "@deephaus/shared";
import { Image as ExpoImage } from "expo-image";
import * as Linking from "expo-linking";
import { useLocalSearchParams } from "expo-router";
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
import { ExplainSheet } from "@/components/study/explain-sheet";
import { ReviewDock, ReviewDockFooter } from "@/components/study/review-dock";
import { SessionEnd } from "@/components/study/session-end";
import { StudyCardContent } from "@/components/study/study-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SessionGuard } from "@/components/session-guard";
import { ScreenHeader } from "@/components/ui/screen-header";
import { deckDisplayName } from "@/lib/deck-name";
import {
  examReasonLabel,
  formatRecall,
  formatSessionTime,
  isCramWindow,
} from "@/lib/exams";
import { haptics } from "@/lib/haptics";
import { useHeaderInset } from "@/lib/header-inset";
import { useStudyLiveActivity } from "@/lib/live-activities/use-study-live-activity";
import { goBackOrReplace } from "@/lib/navigation";
import { offlineData } from "@/lib/offline-data";
import { posthog } from "@/lib/posthog";
import { readStoredStudyAudioAutoplay, writeStoredStudyAudioAutoplay } from "@/lib/study/audio-autoplay";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const PAGE_SIZE = 50;
const FONT_SCALES = [0.85, 1, 1.15, 1.3];

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
  card: ExamQueueCard;
  grade: ReviewGrade;
  previousState: Record<string, unknown> | null;
  reviewId?: string;
  nextState: Record<string, unknown>;
  log: Record<string, unknown>;
};

function applyRestoreToCard(card: ExamQueueCard, restored: Record<string, unknown>): ExamQueueCard {
  return {
    ...card,
    state: Number(restored.state ?? card.state),
    due: typeof restored.due === "string" ? restored.due : card.due,
    reps: Number(restored.reps ?? card.reps),
    lapses: Number(restored.lapses ?? card.lapses),
    is_new: typeof restored.is_new === "boolean" ? restored.is_new : card.is_new,
    intervals:
      restored.intervals && typeof restored.intervals === "object"
        ? (restored.intervals as ExamQueueCard["intervals"])
        : card.intervals,
  };
}

/** Cards ready across the whole exam right now, not only the page that was sent. */
function readyCount(data: ExamQueueResponse): number {
  return Math.max(data.cards.length, data.counts.due + data.counts.new);
}

export default function ExamSessionRoute() {
  return (
    <SessionGuard>
      <ExamSessionScreen />
    </SessionGuard>
  );
}

function ExamSessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { examId } = useLocalSearchParams<{ examId: string }>();
  const backFallback = { pathname: "/exams/[examId]", params: { examId } } as const;
  const leaveSession = () => goBackOrReplace(backFallback);

  const [queue, setQueue] = useState<ExamQueueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refilling, setRefilling] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exam, setExam] = useState<ExamSummaryDto | null>(null);
  // Ready cards left out because today's time cap is spent, and when more open.
  const [skipped, setSkipped] = useState(0);
  const [nextReadyAt, setNextReadyAt] = useState<string | null>(null);
  const [mediaDeferred, setMediaDeferred] = useState(0);
  // The latest page: where it starts in `queue` and how many cards were ready
  // across the exam when it was fetched. Together they give "left" for the bar.
  const [page, setPage] = useState({ start: 0, ready: 0 });
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  // Per-grade counts and start time feed the end screen and the Live Activity.
  const [stats, setStats] = useState<GradeCounts>(NO_GRADES);
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [panelMode, setPanelMode] = useState<"edit" | "explain" | null>(null);
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

  const shownAt = useRef(Date.now());
  const inFlightGradesRef = useRef<Set<number>>(new Set());
  // Cards answered this session, with the review count each had before its
  // grade. A refill that still shows a card at that count was read before the
  // grade landed, so the card is left out. One that has moved on is a real
  // return (a learning step coming due) and is kept.
  const answeredRef = useRef<Map<string, number>>(new Map());

  const current = queue[index] ?? null;
  const fontScale = FONT_SCALES[fontIndex];
  const reviewed = stats.again + stats.hard + stats.good + stats.easy;
  const remaining = Math.max(queue.length - index, page.ready - (index - page.start), 0);
  const examName = exam?.name ?? "";
  const title = examName || "Exam session";

  // Dynamic Island / Lock Screen card for the session; tapping it returns here.
  const liveActivityUrl = useMemo(
    () => (examId ? Linking.createURL(`/study/exam/${examId}`) : ""),
    [examId],
  );
  const recallNow = exam?.snapshot.recall_now ?? null;
  const sameDay = exam ? isCramWindow(exam.exam_at) : false;
  const sessionComplete = !loading && !refilling && !current;
  const liveActivityState = useMemo(() => {
    if (!examId || sessionStartedAt == null) return null;
    if (sessionComplete && reviewed === 0) return null;
    return {
      kind: "exam" as const,
      title: examName,
      recallNow,
      sameDay,
      done: reviewed,
      remaining,
      grades: stats,
      startedAt: sessionStartedAt,
      status: sessionComplete ? ("complete" as const) : ("active" as const),
      url: liveActivityUrl,
    };
  }, [
    examId,
    examName,
    liveActivityUrl,
    recallNow,
    remaining,
    reviewed,
    sameDay,
    sessionComplete,
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

  const applyQueueMeta = useCallback(
    (data: ExamQueueResponse & { offline_media_deferred?: number }) => {
      setExam(data.exam);
      setSkipped(data.skipped);
      setNextReadyAt(data.next_ready_at);
      setMediaDeferred(data.offline_media_deferred ?? 0);
    },
    [],
  );

  const loadQueue = useCallback(async () => {
    if (!examId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await offlineData.getExamQueue(examId, { limit: PAGE_SIZE });
      inFlightGradesRef.current.clear();
      answeredRef.current.clear();
      applyQueueMeta(data);
      setQueue(data.cards);
      setPage({ start: 0, ready: readyCount(data) });
      setIndex(0);
      setRevealed(false);
      setUndoStack([]);
      setRedoStack([]);
      setStats(NO_GRADES);
      setSessionStartedAt(data.cards.length > 0 ? Date.now() : null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load this session.");
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [applyQueueMeta, examId]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  // Warm expo-image's disk cache for the page's media so cards render
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
  }, [current?.queue_key]);

  // Time each answer from when its card came on screen, including a card
  // brought back by undo or by a failed save.
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index, current?.queue_key]);

  /** A finished page: ask what is ready now and carry on from `fromIndex`. */
  const refillQueue = useCallback(
    async (fromIndex: number) => {
      if (!examId) return false;
      setRefilling(true);
      try {
        const data = await offlineData.getExamQueue(examId, { limit: PAGE_SIZE });
        applyQueueMeta(data);
        const fresh = data.cards.filter((card) => {
          const repsBefore = answeredRef.current.get(card.queue_key);
          return repsBefore === undefined || card.reps > repsBefore;
        });
        const left = readyCount(data) - (data.cards.length - fresh.length);
        setPage({ start: fromIndex, ready: Math.max(fresh.length, left) });
        if (fresh.length > 0) {
          setQueue((prev) => [...prev.slice(0, fromIndex), ...fresh]);
          setIndex(fromIndex);
          return true;
        }
        return false;
      } catch {
        // The grade itself was saved; the end screen offers another look.
        return false;
      } finally {
        setRefilling(false);
      }
    },
    [applyQueueMeta, examId],
  );

  function grade(gradeId: ReviewGrade) {
    if (!current || !examId || busy) return;
    const gradedIndex = index;
    // Guard against double-taps on the same queue slot; the save runs in the
    // background so the next card's Show answer isn't blocked on the network.
    if (inFlightGradesRef.current.has(gradedIndex)) return;
    inFlightGradesRef.current.add(gradedIndex);
    haptics.medium();
    setBusy(true);
    const gradedCard = current;
    const responseMs = responseMsSince(shownAt.current);
    const advancingToDone = gradedIndex + 1 >= queue.length;

    // Advance optimistically so the next card is interactive immediately.
    setRevealed(false);
    setStats((s) => ({ ...s, [gradeId]: s[gradeId] + 1 }));
    answeredRef.current.set(gradedCard.queue_key, gradedCard.reps);
    if (advancingToDone) {
      // Don't flash the end screen: more may be ready past this page, and a
      // card rated Again comes back for its next step.
      setRefilling(true);
      setIndex(queue.length);
    } else {
      setIndex(gradedIndex + 1);
    }

    posthog.capture("card_reviewed", {
      exam_id: examId,
      context: "exam",
      grade: gradeId,
      card_type: gradedCard.type,
      is_new: gradedCard.is_new,
    });
    offlineData
      .submitReview(gradedCard.id, {
        rating: GRADE_RATINGS[gradeId],
        cloze_ord: gradedCard.cloze_ord ?? undefined,
        context: "exam",
        exam_id: examId,
        response_ms: responseMs,
        client_mutation_id: generateUuid(),
      })
      .then(async (response) => {
        setUndoStack((stack) => [
          ...stack,
          {
            cardIndex: gradedIndex,
            card: gradedCard,
            grade: gradeId,
            previousState: (response.previous_state as Record<string, unknown> | null) ?? null,
            reviewId: typeof response.review_id === "string" ? response.review_id : undefined,
            nextState: (response.next_state as Record<string, unknown>) ?? {},
            log: (response.log as Record<string, unknown>) ?? {},
          },
        ]);
        setRedoStack([]);
        if (advancingToDone) {
          await refillQueue(gradedIndex + 1);
        }
      })
      .catch((e) => {
        // Roll back the optimistic advance if the save failed.
        setStats((s) => ({ ...s, [gradeId]: Math.max(0, s[gradeId] - 1) }));
        answeredRef.current.delete(gradedCard.queue_key);
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

  // Exam cards are ordinary cards, so undo and redo use the deck session's
  // restore path. The review log keeps its exam context either way.
  function undo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || busy) return;
    haptics.light();

    setBusy(true);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
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
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
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
    setQueue((cards) =>
      cards.map((card, cardIndex) =>
        cardIndex === index
          ? {
              ...card,
              front: updated.front,
              back: updated.back,
              cloze_text: updated.cloze_text,
              extra: updated.extra,
            }
          : card,
      ),
    );
  }

  if (loading || refilling) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
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

  if (!current) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title={title}
          backFallback={backFallback}
          actions={
            undoStack.length > 0
              ? [
                  {
                    icon: "undo",
                    sfIcon: "arrow.uturn.backward",
                    label: "Undo",
                    onPress: () => undo(),
                  },
                ]
              : undefined
          }
        />
        <SafeAreaView style={styles.completeRoot} edges={["bottom"]}>
          <SessionDone
            exam={exam}
            stats={stats}
            startedAt={sessionStartedAt}
            skipped={skipped}
            nextReadyAt={nextReadyAt}
            mediaDeferred={mediaDeferred}
            onCheckAgain={() => void loadQueue()}
            onDone={leaveSession}
          />
        </SafeAreaView>
      </View>
    );
  }

  const progressTotal = reviewed + remaining;
  const progress = progressTotal <= 0 ? 1 : Math.min(1, reviewed / progressTotal);

  return (
    <View style={[styles.root, { paddingTop: headerInset }]}>
      <ScreenHeader
        title={title}
        backFallback={backFallback}
        actions={[
          {
            icon: "undo",
            sfIcon: "arrow.uturn.backward",
            label: "Undo",
            disabled: undoStack.length === 0,
            onPress: () => undo(),
          },
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
            ],
          },
        ]}
      />

      <ProgressBar value={progress} height={2} style={styles.progressLine} />

      <Pressable style={styles.cardBody} onPress={revealAnswer} disabled={revealed || busy}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.questionWrap}
          showsVerticalScrollIndicator={false}
        >
          {/* Why this card is here, and the deck it comes from. */}
          <Text style={styles.cardReason} numberOfLines={1}>
            {examReasonLabel(current.reason)}
            {current.deck_name ? ` · ${deckDisplayName(current.deck_name)}` : ""}
          </Text>
          <StudyCardContent card={current} revealed={revealed} fontScale={fontScale} />
        </ScrollView>
      </Pressable>

      <ReviewDock
        revealed={revealed}
        disabled={busy}
        intervals={current.intervals}
        onReveal={revealAnswer}
        onGrade={(gradeId) => grade(gradeId)}
        bottomInset={insets.bottom}
        footer={
          <ReviewDockFooter>
            <Text style={styles.footerText} numberOfLines={1}>
              {reviewed} done · {remaining} left
            </Text>
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
          card={current as StudyCardFields}
          onClose={() => setPanelMode(null)}
          onSaved={(updated) => {
            updateCurrentCard(updated);
          }}
        />
      ) : null}
    </View>
  );
}

/** Nothing is ready: what the session came to, and when the next cards open. */
function SessionDone({
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
    progressLine: {
      borderRadius: 0,
    },
    cardReason: {
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center",
      color: colors.fgTertiary,
      marginBottom: 20,
    },
    cardBody: {
      flex: 1,
      minHeight: 0,
    },
    questionWrap: {
      flexGrow: 1,
      paddingTop: 28,
      paddingBottom: 32,
      paddingHorizontal: 24,
    },
    footerText: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    completeRoot: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
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
