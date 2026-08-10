import type { ReviewCardPayload, ReviewGrade } from "@deephaus/api-client";
import { extractCardMediaDisplayUrls, parseCardContent, parseImageOcclusionData } from "@deephaus/shared";
import { Image as ExpoImage } from "expo-image";
import { router, useLocalSearchParams } from "expo-router";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { PageHeader, PageHeaderIconButton } from "@/components/ui/page-header";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { RichCardContent } from "@/components/rich-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { StudyOptionsSheet } from "@/components/study/study-options-sheet";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

function getGrades(colors: ThemeColors): Array<{ id: ReviewGrade; label: string; color: string }> {
  return [
    { id: "again", label: "Again", color: colors.gradeAgain },
    { id: "hard", label: "Hard", color: colors.gradeHard },
    { id: "good", label: "Good", color: colors.gradeGood },
    { id: "easy", label: "Easy", color: colors.gradeEasy },
  ];
}

const FONT_SCALES = [0.85, 1, 1.15, 1.3];
const SWIPE_GRADE_THRESHOLD = 72;
const REVIEW_PRIMARY_ROW_HEIGHT = 72;
const DEFAULT_DAY_START_HOUR = 4;

type HistoryEntry = {
  cardIndex: number;
  card: ReviewCardPayload;
  grade: ReviewGrade;
  previousState: Record<string, unknown> | null;
  nextState: Record<string, unknown>;
  log: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Deck-wide daily counts (ported from the web reviewer). "Again"-graded cards
// re-enter learning and stay counted until they're truly done for the day.
// ---------------------------------------------------------------------------

type QueueCounts = { due: number; learning: number; new: number };

function isLearningState(state: number) {
  return state === 1 || state === 3;
}

function cardCountBucket(card: { is_new: boolean; state: number }): "new" | "learning" | "review" {
  if (card.is_new || card.state === 0) return "new";
  if (isLearningState(card.state)) return "learning";
  return "review";
}

function removeCardFromCounts(counts: QueueCounts, bucket: "new" | "learning" | "review"): QueueCounts {
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
  if (!Number.isFinite(dueMs)) return false;
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

function nextStateFields(nextState: Record<string, unknown>): { state: number; due: string } | null {
  const state = Number(nextState.state);
  const due = typeof nextState.due === "string" ? nextState.due : null;
  if (!Number.isFinite(state) || !due) return null;
  return { state, due };
}

/** Apply a successful review to deck-wide daily remaining counts. */
function applyReviewToCounts(
  counts: QueueCounts,
  before: { is_new: boolean; state: number },
  after: { state: number; due: string } | null,
  dayStartHour: number,
): QueueCounts {
  const removed = removeCardFromCounts(counts, cardCountBucket(before));
  if (!after) return removed;
  return addDueCardToCounts(removed, after.state, after.due, Date.now(), dayStartHour);
}

/** Undo a review's effect on deck-wide daily remaining counts. */
function revertReviewFromCounts(
  counts: QueueCounts,
  before: { is_new: boolean; state: number },
  after: { state: number; due: string } | null,
  dayStartHour: number,
): QueueCounts {
  let next = counts;
  if (after && isStillDueToday(after.due, Date.now(), dayStartHour)) {
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

export default function StudySessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const grades = useMemo(() => getGrades(colors), [colors]);
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const [queue, setQueue] = useState<ReviewCardPayload[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refilling, setRefilling] = useState(false);
  const [deckName, setDeckName] = useState("");
  // True deck-wide totals from the server (not the 50-card local queue).
  const [counts, setCounts] = useState<QueueCounts>({ due: 0, learning: 0, new: 0 });
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_START_HOUR);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [fontIndex, setFontIndex] = useState(1);
  const [busy, setBusy] = useState(false);
  const [panelMode, setPanelMode] = useState<"edit" | "explain" | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [suspending, setSuspending] = useState(false);
  const swipeX = useRef(new Animated.Value(0)).current;
  const revealedRef = useRef(revealed);
  const busyRef = useRef(busy);
  revealedRef.current = revealed;
  busyRef.current = busy;

  const current = queue[index] ?? null;
  const fontScale = FONT_SCALES[fontIndex];

  const gradeRef = useRef<(gradeId: ReviewGrade) => void>(() => {});
  const inFlightGradesRef = useRef<Set<number>>(new Set());

  const loadQueue = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    try {
      const data = await offlineData.getStudyQueue(deckId, { limit: 50 });
      inFlightGradesRef.current.clear();
      setQueue(data.cards);
      setDeckName(data.deck.name);
      setCounts({
        due: data.counts.due,
        learning: data.counts.learning,
        new: data.counts.new_today_remaining ?? data.counts.new,
      });
      setDayStartHour(data.day_start_hour ?? DEFAULT_DAY_START_HOUR);
      setIndex(0);
      setRevealed(false);
      setUndoStack([]);
      setRedoStack([]);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
    } catch (e) {
      Alert.alert("Study failed", e instanceof Error ? e.message : "Could not load queue");
    } finally {
      setLoading(false);
    }
  }, [deckId]);

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
    setOptionsOpen(false);
  }, [current?.queue_key]);

  const refillQueue = useCallback(
    async (fromIndex: number) => {
      if (!deckId) return false;
      setRefilling(true);
      try {
        const data = await offlineData.getStudyQueue(deckId, { limit: 50 });
        // Refresh the true totals even when the refill comes back empty.
        setCounts({
          due: data.counts.due,
          learning: data.counts.learning,
          new: data.counts.new_today_remaining ?? data.counts.new,
        });
        if (data.cards.length > 0) {
          setQueue((prev) => {
            // Drop cards already reviewed in this session (re-fetched by ID).
            const reviewed = new Set(prev.slice(0, fromIndex).map((c) => c.queue_key));
            const fresh = data.cards.filter((c) => !reviewed.has(c.queue_key));
            return [...prev.slice(0, fromIndex), ...fresh];
          });
          setIndex(fromIndex);
          return true;
        }
        return false;
      } catch {
        return false;
      } finally {
        setRefilling(false);
      }
    },
    [deckId],
  );

  function grade(gradeId: ReviewGrade) {
    if (!current) return;
    const gradedIndex = index;
    // Guard against double-taps on the same queue slot; the save runs in the
    // background so `busy` no longer blocks the next card's Show Answer.
    if (inFlightGradesRef.current.has(gradedIndex)) return;
    inFlightGradesRef.current.add(gradedIndex);
    const gradedCard = current;
    const advancingToDone = gradedIndex + 1 >= queue.length;

    // Advance optimistically so the next card is interactive immediately.
    setRevealed(false);
    swipeX.setValue(0);
    setStats((s) => ({ ...s, [gradeId]: s[gradeId] + 1 }));
    if (advancingToDone) {
      // Don't flash the completion screen — the deck may have more due or
      // learning cards (including "Again" cards re-scheduled this session).
      // Show the refill spinner until the server confirms what's left.
      setRefilling(true);
      setIndex(queue.length);
    } else {
      setIndex(gradedIndex + 1);
    }

    offlineData
      .submitReview(gradedCard.id, {
        grade: gradeId,
        cloze_ord: gradedCard.cloze_ord ?? undefined,
      })
      .then(async (response) => {
        const nextState = (response.next_state as Record<string, unknown>) ?? {};
        // Counts follow the web reviewer: remove the graded card's bucket,
        // then re-add it if the new schedule keeps it due today ("Again").
        setCounts((c) =>
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
            nextState,
            log: (response.log as Record<string, unknown>) ?? {},
          },
        ]);
        setRedoStack([]);
        const updatedIntervals = (response.intervals ?? gradedCard.intervals) as ReviewCardPayload["intervals"];
        setQueue((q) => {
          const next = [...q];
          next[gradedIndex] = { ...gradedCard, intervals: updatedIntervals };
          return next;
        });
        if (advancingToDone) {
          await refillQueue(gradedIndex + 1);
        }
      })
      .catch((e) => {
        // Roll back the optimistic advance if the save failed.
        setStats((s) => ({ ...s, [gradeId]: Math.max(0, s[gradeId] - 1) }));
        setRefilling(false);
        setIndex(gradedIndex);
        setRevealed(true);
        Alert.alert("Grade failed", e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => {
        inFlightGradesRef.current.delete(gradedIndex);
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

  function undo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || busy) return;

    // Apply optimistically so the reviewer doesn't freeze on the network round-trip.
    setBusy(true);
    setUndoStack((stack) => stack.slice(0, -1));
    setRedoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
    const before = { is_new: entry.card.is_new, state: entry.card.state };
    const after = nextStateFields(entry.nextState);
    setCounts((c) => revertReviewFromCounts(c, before, after, dayStartHour));
    setIndex(entry.cardIndex);
    setRevealed(true);

    offlineData
      .restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.previousState,
        log_action: "delete_latest",
      })
      .catch((e) => {
        // Roll back the optimistic state if the server rejects the restore.
        setUndoStack((stack) => [...stack, entry]);
        setRedoStack((stack) => stack.slice(0, -1));
        setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
        setCounts((c) => applyReviewToCounts(c, before, after, dayStartHour));
        if (entry.cardIndex + 1 >= queue.length) {
          setIndex(queue.length);
        } else {
          setIndex(entry.cardIndex + 1);
        }
        setRevealed(false);
        Alert.alert("Undo failed", e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => setBusy(false));
  }

  function redo() {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || busy) return;

    setBusy(true);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
    const before = { is_new: entry.card.is_new, state: entry.card.state };
    const after = nextStateFields(entry.nextState);
    setCounts((c) => applyReviewToCounts(c, before, after, dayStartHour));
    setRevealed(false);
    if (entry.cardIndex + 1 >= queue.length) {
      setIndex(queue.length);
    } else {
      setIndex(entry.cardIndex + 1);
    }

    offlineData
      .restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.nextState,
        log_action: "insert",
        log: entry.log,
      })
      .catch((e) => {
        setRedoStack((stack) => [...stack, entry]);
        setUndoStack((stack) => stack.slice(0, -1));
        setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
        setCounts((c) => revertReviewFromCounts(c, before, after, dayStartHour));
        setIndex(entry.cardIndex);
        setRevealed(true);
        Alert.alert("Redo failed", e instanceof Error ? e.message : "Unknown error");
      })
      .finally(() => setBusy(false));
  }

  function revealAnswer() {
    if (!revealed && !busy) setRevealed(true);
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
    setOptionsOpen(false);
    setSuspending(true);
    const suspendedIndex = index;
    try {
      await offlineData.suspendCard(current.id, true);
      setRevealed(false);
      setCounts((c) => removeCardFromCounts(c, cardCountBucket(current)));
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
    } catch (e) {
      Alert.alert("Suspend failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSuspending(false);
    }
  }

  if (loading || refilling) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "bottom"]}>
        <ActivityIndicator color={colors.brand500} />
      </SafeAreaView>
    );
  }

  if (!current) {
    return (
      <SessionComplete
        deckName={deckName}
        stats={stats}
        onAgain={() => void loadQueue()}
      />
    );
  }

  const activeCloze = current.cloze_ord ?? undefined;
  // Progress across everything left for the deck today (learning + due + new),
  // not just the cards loaded into this session page — mirrors the web reviewer.
  const sessionCompleted = stats.again + stats.hard + stats.good + stats.easy;
  const remainingToday = counts.due + counts.new;
  const progressTotal = sessionCompleted + remainingToday;
  const progressPct =
    progressTotal <= 0 ? 100 : Math.min(100, (sessionCompleted / progressTotal) * 100);
  const activeBucket = cardCountBucket(current);
  const dueRemaining = Math.max(0, counts.due - counts.learning);

  return (
    <View style={styles.root}>
      <PageHeader
        style={styles.header}
        title={deckName}
        onBack={() => router.back()}
        right={
          <>
            <PageHeaderIconButton
              icon="pencil"
              label="Edit card"
              onPress={() => setPanelMode("edit")}
            />
            <PageHeaderIconButton
              icon="sparkles"
              label="AI explainer"
              onPress={() => setPanelMode("explain")}
            />
            <PageHeaderIconButton
              icon="more"
              label="Study options"
              onPress={() => setOptionsOpen(true)}
            />
          </>
        }
      />

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
          <Card padding={20} style={styles.studyCard}>
            <Pressable style={styles.cardBody} onPress={revealAnswer} disabled={revealed || busy}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.questionWrap}
                showsVerticalScrollIndicator={false}
                scrollEnabled={revealed}
              >
                {current.type === "image-occlusion" ? (
                  <>
                    {parseCardContent(current.front ?? "")
                      .filter((segment) => segment.type === "text" && segment.value.trim().length > 0)
                      .map((segment, index) => (
                        <Text key={index} style={[styles.occlusionHeader, { fontSize: 17 * fontScale }]}>
                          {segment.type === "text" ? segment.value.trim() : ""}
                        </Text>
                      ))}
                    <OcclusionRenderer
                      data={parseImageOcclusionData(current.occlusion_data)}
                      activeOrd={activeCloze}
                      revealed={revealed}
                      studyView
                      imageHeight={240 * fontScale}
                    />
                    {revealed && (current.back || current.extra) ? (
                      <>
                        <View style={styles.answerDivider} />
                        <RichCardContent
                          content={current.back ?? current.extra}
                          studyView
                          fontScale={fontScale}
                        />
                      </>
                    ) : null}
                  </>
                ) : current.type === "basic" ? (
                  <>
                    <RichCardContent
                      content={current.front}
                      studyView
                      fontScale={fontScale}
                    />
                    {revealed && current.back && (
                      <>
                        <View style={styles.answerDivider} />
                        <RichCardContent content={current.back} studyView fontScale={fontScale} />
                      </>
                    )}
                    {revealed && current.extra && (
                      <RichCardContent content={current.extra} fontScale={fontScale} />
                    )}
                  </>
                ) : (
                  <>
                    <RichCardContent
                      content={current.cloze_text}
                      clozeMode={revealed ? "revealed" : "hidden"}
                      activeClozeOrd={activeCloze}
                      studyView
                      fontScale={fontScale}
                    />
                    {revealed && current.extra && (
                      <RichCardContent content={current.extra} fontScale={fontScale} />
                    )}
                  </>
                )}
              </ScrollView>
            </Pressable>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressPct}%` }]} />
            </View>
          </Card>
        </Animated.View>
      </View>

      <View style={[styles.footerShell, { paddingBottom: insets.bottom }]}>
        <View style={styles.footerSafe}>
          <View style={styles.reviewChrome}>
          <View style={styles.reviewPrimaryRow}>
            {revealed ? (
              <View style={styles.gradeRow}>
                {grades.map((g, i) => (
                  <Pressable
                    key={g.id}
                    onPress={() => void grade(g.id)}
                    disabled={busy}
                    style={({ pressed }) => [
                      styles.gradeBtn,
                      i < grades.length - 1 && styles.gradeBtnDivider,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Text style={[styles.gradeLabel, { color: g.color }]}>{g.label}</Text>
                    <Text style={styles.gradeInterval}>{current.intervals[g.id]}</Text>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Pressable
                onPress={revealAnswer}
                disabled={busy}
                style={({ pressed }) => [styles.showAnswerBtn, pressed && { opacity: 0.92 }]}
              >
                <Text style={styles.showAnswerText}>Show Answer</Text>
              </Pressable>
            )}
          </View>

          <View style={styles.reviewFooterBar}>
            <Pressable
              onPress={() => void undo()}
              disabled={undoStack.length === 0 || busy}
              accessibilityLabel="Undo"
              accessibilityRole="button"
              style={[
                styles.historyBtn,
                (undoStack.length === 0 || busy) && styles.historyBtnDisabled,
              ]}
            >
              <Icon name="undo" size={16} color={colors.fgSecondary} />
            </Pressable>

            <View style={styles.statusCounts}>
              <View
                accessible
                accessibilityLabel={`${counts.learning} learning`}
                accessibilityState={{ selected: activeBucket === "learning" }}
                style={[styles.countChip, styles.countChipLearning]}
              >
                <View style={[styles.countDot, styles.countDotLearning]} />
                <Text style={[styles.countChipText, styles.countTextLearning]}>
                  {counts.learning} learning
                </Text>
                {activeBucket === "learning" ? (
                  <View style={[styles.countUnderline, styles.countUnderlineLearning]} />
                ) : null}
              </View>
              <View
                accessible
                accessibilityLabel={`${dueRemaining} due`}
                accessibilityState={{ selected: activeBucket === "review" }}
                style={[styles.countChip, styles.countChipDue]}
              >
                <View style={[styles.countDot, styles.countDotDue]} />
                <Text style={[styles.countChipText, styles.countTextDue]}>
                  {dueRemaining} due
                </Text>
                {activeBucket === "review" ? (
                  <View style={[styles.countUnderline, styles.countUnderlineDue]} />
                ) : null}
              </View>
              <View
                accessible
                accessibilityLabel={`${counts.new} new`}
                accessibilityState={{ selected: activeBucket === "new" }}
                style={[styles.countChip, styles.countChipNew]}
              >
                <View style={[styles.countDot, styles.countDotNew]} />
                <Text style={[styles.countChipText, styles.countTextNew]}>
                  {counts.new} new
                </Text>
                {activeBucket === "new" ? (
                  <View style={[styles.countUnderline, styles.countUnderlineNew]} />
                ) : null}
              </View>
            </View>

            <Pressable
              onPress={() => void redo()}
              disabled={redoStack.length === 0 || busy}
              accessibilityLabel="Redo"
              accessibilityRole="button"
              style={[
                styles.historyBtn,
                styles.historyBtnRight,
                (redoStack.length === 0 || busy) && styles.historyBtnDisabled,
              ]}
            >
              <Icon name="redo" size={16} color={colors.fgSecondary} />
            </Pressable>
          </View>
        </View>
      </View>
      </View>

      {panelMode && current ? (
        <StudyCardPanel
          mode={panelMode}
          card={current}
          visible
          onClose={() => setPanelMode(null)}
          onSaved={(updated) => {
            updateCurrentCard(updated);
            setPanelMode(null);
          }}
        />
      ) : null}

      <StudyOptionsSheet
        visible={optionsOpen}
        fontIndex={fontIndex}
        fontScaleCount={FONT_SCALES.length}
        onClose={() => setOptionsOpen(false)}
        onDecreaseFont={() => setFontIndex((i) => Math.max(0, i - 1))}
        onIncreaseFont={() => setFontIndex((i) => Math.min(FONT_SCALES.length - 1, i + 1))}
        onSuspend={() => void suspendCurrentCard()}
        suspending={suspending}
      />
    </View>
  );
}

function SessionComplete({
  deckName,
  stats,
  onAgain,
}: {
  deckName: string;
  stats: { again: number; hard: number; good: number; easy: number };
  onAgain: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const grades = useMemo(() => getGrades(colors), [colors]);
  const total = stats.again + stats.hard + stats.good + stats.easy;
  return (
    <SafeAreaView style={styles.completeRoot} edges={["top", "bottom"]}>
      <View style={styles.completeContent}>
        <Card padding={24} style={styles.completeCard}>
          <FeaturedIcon icon="trophy" variant="brand" size="2xl" />
          <Text style={styles.completeTitle}>Session complete</Text>
          <Text style={styles.completeSub}>
            {deckName} · {total} card{total === 1 ? "" : "s"}
          </Text>

          <View style={styles.completeTiles}>
            {grades.map((g) => (
              <View key={g.id} style={styles.completeTile}>
                <Text style={[styles.completeValue, { color: g.color }]}>
                  {stats[g.id]}
                </Text>
                <Text style={styles.completeLabel}>{g.label}</Text>
              </View>
            ))}
          </View>
        </Card>
      </View>

      <View style={styles.completeActions}>
        <Button
          variant="brand"
          size="xl"
          label="Done"
          trailingIcon="check"
          fullWidth
          onPress={() => router.back()}
        />
        <Button
          variant="tertiary"
          size="lg"
          label="Study more cards"
          fullWidth
          onPress={onAgain}
        />
      </View>
    </SafeAreaView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, minHeight: 0, backgroundColor: colors.bgCanvas },
    header: { flexShrink: 0 },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.bgCanvas,
    },
    cardArea: {
      flex: 1,
      minHeight: 0,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12,
      position: "relative",
    },
    swipeTint: {
      position: "absolute",
      top: 16,
      left: 16,
      right: 16,
      bottom: 16,
      borderRadius: radius.lg,
    },
    swipeTintAgain: {
      backgroundColor: colors.gradeAgain,
    },
    swipeTintGood: {
      backgroundColor: colors.gradeGood,
    },
    studyCard: {
      flex: 1,
      minHeight: 0,
      gap: 0,
    },
    cardBody: {
      flex: 1,
      minHeight: 0,
    },
    questionWrap: {
      flexGrow: 1,
      justifyContent: "center",
      paddingVertical: 24,
      paddingHorizontal: 4,
    },
    answerDivider: {
      height: 1,
      backgroundColor: colors.borderSecondary,
      marginVertical: 20,
    },
    occlusionHeader: {
      color: colors.fgPrimary,
      lineHeight: 24,
      marginBottom: 12,
      textAlign: "center",
    },
    progressTrack: {
      height: 4,
      backgroundColor: colors.gray200,
      borderRadius: 999,
      overflow: "hidden",
    },
    progressFill: {
      height: 4,
      backgroundColor: colors.brand500,
      borderRadius: 999,
    },
    footerShell: {
      flexShrink: 0,
      backgroundColor: colors.bgSurface,
    },
    footerSafe: {
      backgroundColor: colors.bgSurface,
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
    },
    reviewChrome: {
      backgroundColor: colors.bgSurface,
      overflow: "hidden",
    },
    reviewFooterBar: {
      flexDirection: "row",
      alignItems: "center",
      paddingHorizontal: 12,
      paddingVertical: 8,
      minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
      gap: 8,
    },
    historyBtn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      width: 36,
      height: 36,
      borderRadius: radius.md,
    },
    historyBtnRight: {
      marginLeft: "auto",
    },
    historyBtnDisabled: {
      opacity: 0.4,
    },
    reviewPrimaryRow: {
      height: REVIEW_PRIMARY_ROW_HEIGHT,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
    },
    gradeRow: {
      flexDirection: "row",
      height: REVIEW_PRIMARY_ROW_HEIGHT,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
    },
    gradeBtn: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: colors.bgSurface,
    },
    gradeBtnDivider: {
      borderRightColor: colors.borderSecondary,
      borderRightWidth: 1,
    },
    gradeLabel: {
      fontSize: 14,
      lineHeight: 18,
      fontWeight: "600",
    },
    gradeInterval: {
      fontSize: 11,
      lineHeight: 14,
      color: colors.fgQuaternary,
      fontWeight: "500",
    },
    showAnswerBtn: {
      height: REVIEW_PRIMARY_ROW_HEIGHT,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.actionPrimaryBg,
    },
    showAnswerText: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.actionPrimaryFg,
    },
    statusCounts: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
    },
    countChip: {
      position: "relative",
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    countChipLearning: {
      backgroundColor: colors.gradeAgainBg,
    },
    countChipDue: {
      backgroundColor: colors.orange50,
    },
    countChipNew: {
      backgroundColor: colors.brand50,
    },
    countDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
    },
    countDotLearning: {
      backgroundColor: colors.gradeAgain,
    },
    countDotDue: {
      backgroundColor: colors.orange700,
    },
    countDotNew: {
      backgroundColor: colors.brand700,
    },
    countChipText: {
      fontSize: 12,
      lineHeight: 14,
      fontWeight: "500",
    },
    countTextLearning: {
      color: colors.gradeAgain,
    },
    countTextDue: {
      color: colors.orange700,
    },
    countTextNew: {
      color: colors.brand700,
    },
    countUnderline: {
      position: "absolute",
      left: 8,
      right: 8,
      bottom: -4,
      height: 2,
      borderRadius: radius.pill,
    },
    countUnderlineLearning: {
      backgroundColor: colors.gradeAgain,
    },
    countUnderlineDue: {
      backgroundColor: colors.orange700,
    },
    countUnderlineNew: {
      backgroundColor: colors.brand700,
    },
    completeRoot: { flex: 1, backgroundColor: colors.bgCanvas, padding: 20, justifyContent: "center" },
    completeContent: { flex: 0, paddingBottom: 16 },
    completeCard: { alignItems: "center", gap: 8 },
    completeTitle: {
      fontSize: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 16,
      letterSpacing: -0.4,
    },
    completeSub: {
      fontSize: 14,
      color: colors.fgTertiary,
      marginTop: 4,
    },
    completeTiles: {
      flexDirection: "row",
      gap: 8,
      marginTop: 20,
      alignSelf: "stretch",
    },
    completeTile: {
      flex: 1,
      paddingVertical: 12,
      paddingHorizontal: 4,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
      borderColor: colors.borderSecondary,
      borderWidth: 1,
      alignItems: "center",
    },
    completeValue: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "700",
      letterSpacing: -0.4,
    },
    completeLabel: {
      fontSize: 11,
      color: colors.fgTertiary,
      fontWeight: "500",
      marginTop: 4,
    },
    completeActions: {
      gap: 10,
    },
  });
}
