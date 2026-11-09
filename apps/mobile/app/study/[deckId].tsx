import {cardCountBucket,applyReviewToCounts,revertReviewFromCounts,removeCardFromCounts} from "@deephaus/scheduling";
import type { ReviewCardPayload, ReviewGrade } from "@deephaus/api-client";
import { extractCardMediaDisplayUrls } from "@deephaus/shared";
import { Image as ExpoImage } from "expo-image";
import * as Linking from "expo-linking";
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
import { useDeckActions } from "@/components/deck-actions";
import { ExplainSheet } from "@/components/study/explain-sheet";
import { ReviewDock, ReviewDockFooter } from "@/components/study/review-dock";
import { SessionEnd } from "@/components/study/session-end";
import { StudyCardContent } from "@/components/study/study-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { isMenuGroup } from "@/components/ui/menu-sheet";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SessionGuard } from "@/components/session-guard";
import { ScreenHeader } from "@/components/ui/screen-header";
import { LoadError } from "@/components/load-error";
import { formatDeckName } from "@/lib/deck-name";
import { haptics } from "@/lib/haptics";
import { useStudyLiveActivity } from "@/lib/live-activities/use-study-live-activity";
import { readStoredStudyAudioAutoplay, writeStoredStudyAudioAutoplay } from "@/lib/study/audio-autoplay";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import { useHeaderInset } from "@/lib/header-inset";
import { offlineData } from "@/lib/offline-data";
import { goBackOrReplace } from "@/lib/navigation";
import { openSection } from "@/lib/sections";
import { posthog } from "@/lib/posthog";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const FONT_SCALES = [0.85, 1, 1.15, 1.3];
const SWIPE_GRADE_THRESHOLD = 72;
const DEFAULT_DAY_START_HOUR = 4;

type HistoryEntry = {
  cardIndex: number;
  card: ReviewCardPayload;
  grade: ReviewGrade;
  previousState: Record<string, unknown> | null;
  reviewId?: string;
  nextState: Record<string, unknown>;
  log: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Deck-wide daily counts (ported from the web reviewer). "Again"-graded cards
// re-enter learning and stay counted until they're truly done for the day.
// ---------------------------------------------------------------------------

type QueueCounts = { due: number; learning: number; new: number };

function nextStateFields(nextState: Record<string, unknown>): { state: number; due: string } | null {
  const state = Number(nextState.state);
  const due = typeof nextState.due === "string" ? nextState.due : null;
  if (!Number.isFinite(state) || !due) return null;
  return { state, due };
}

function applyRestoreToCard(
  card: ReviewCardPayload,
  restored: Record<string, unknown>,
): ReviewCardPayload {
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

export default function StudySessionRoute() {
  return (
    <SessionGuard>
      <StudySessionScreen />
    </SessionGuard>
  );
}

function StudySessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { deckId } = useLocalSearchParams<{ deckId: string }>();
  const [mediaDeferred,setMediaDeferred]=useState(0);
  const [queue, setQueue] = useState<ReviewCardPayload[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [queueFailed, setQueueFailed] = useState(false);
  const [refilling, setRefilling] = useState(false);
  // Raw, so Rename edits the full "Parent::Leaf" name rather than the leaf.
  const [rawDeckName, setRawDeckName] = useState("");
  // True deck-wide totals from the server (not the 50-card local queue).
  const [counts, setCounts] = useState<QueueCounts>({ due: 0, learning: 0, new: 0 });
  // New cards the daily limit held back; shown on the end screen.
  const [newHeldBack, setNewHeldBack] = useState(0);
  const [dayStartHour, setDayStartHour] = useState(DEFAULT_DAY_START_HOUR);
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);
  const [stats, setStats] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  // When the first card of this session appeared; drives the Live Activity timer.
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

  const deckActions = useDeckActions({
    // The queue doesn't say whether the deck is published, so a label here
    // could be the wrong way round. Decks keeps that action.
    // Opening the deck, adding or browsing cards would push the app's areas on
    // top of this session; leave the session to do those.
    omit: ["study", "publish", "open", "create", "browse"],
    onRenamed: (_deck, name) => setRawDeckName(name),
    // The deck's page under this session is gone too, so end on the Decks list.
    onDeleted: () => {
      if (router.canGoBack()) router.back();
      openSection("decks");
    },
  });

  const deckName = formatDeckName(rawDeckName).title;
  const current = queue[index] ?? null;
  const fontScale = FONT_SCALES[fontIndex];
  // Progress across everything left for the deck today (learning + due + new),
  // not just the cards loaded into this session page — mirrors the web reviewer.
  const sessionCompleted = stats.again + stats.hard + stats.good + stats.easy;
  const remainingToday = counts.due + counts.new;

  // Dynamic Island / Lock Screen card for the session; tapping it returns here.
  const liveActivityUrl = useMemo(() => (deckId ? Linking.createURL(`/study/${deckId}`) : ""), [deckId]);
  const sessionComplete = !loading && !refilling && !current;
  const liveActivityState = useMemo(() => {
    if (!deckId || sessionStartedAt == null) return null;
    if (sessionComplete && sessionCompleted === 0) return null;
    return {
      kind: "review" as const,
      title: deckName,
      done: sessionCompleted,
      remaining: remainingToday,
      grades: stats,
      startedAt: sessionStartedAt,
      status: sessionComplete ? ("complete" as const) : ("active" as const),
      url: liveActivityUrl,
    };
  }, [deckId, deckName, liveActivityUrl, remainingToday, sessionComplete, sessionCompleted, sessionStartedAt, stats]);
  useStudyLiveActivity(liveActivityState);
  useAutoplayCardAudio({
    cardKey: current?.queue_key ?? null,
    questionFields: current?.type === "cloze" ? [current.cloze_text] : [current?.front],
    answerFields: current?.type === "cloze" ? [current.extra] : [current?.back, current?.extra],
    revealed,
    enabled: audioAutoplay,
  });

  const gradeRef = useRef<(gradeId: ReviewGrade) => void>(() => {});
  const inFlightGradesRef = useRef<Set<number>>(new Set());

  const loadQueue = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    try {
      const data = await offlineData.getStudyQueue(deckId, { limit: 50 });
      inFlightGradesRef.current.clear();
      setMediaDeferred(data.offline_media_deferred??0);
      setQueue(data.cards);
      setRawDeckName(data.deck.name);
      setCounts({
        due: data.counts.due,
        learning: data.counts.learning,
        new: data.counts.new_today_remaining ?? data.counts.new,
      });
      setNewHeldBack(data.counts.new_held_back ?? 0);
      setDayStartHour(data.day_start_hour ?? DEFAULT_DAY_START_HOUR);
      setIndex(0);
      setRevealed(false);
      setUndoStack([]);
      setRedoStack([]);
      setStats({ again: 0, hard: 0, good: 0, easy: 0 });
      setSessionStartedAt(data.cards.length > 0 ? Date.now() : null);
      setQueueFailed(false);
    } catch {
      // Shown in place of the session, so a failure doesn't read as "done".
      setQueueFailed(true);
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
        setNewHeldBack(data.counts.new_held_back ?? 0);
        if (data.cards.length > 0) {
          setQueue((prev) => {
            // A card graded Again keeps the same queue_key when it becomes due
            // again. Append the authoritative refreshed queue without
            // filtering seen keys so learning steps can re-enter the session.
            return [...prev.slice(0, fromIndex), ...data.cards];
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
    if (!current || busy) return;
    const gradedIndex = index;
    // Guard against double-taps on the same queue slot; the save runs in the
    // background so `busy` no longer blocks the next card's Show Answer.
    if (inFlightGradesRef.current.has(gradedIndex)) return;
    inFlightGradesRef.current.add(gradedIndex);
    haptics.medium();
    setBusy(true);
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

    posthog.capture("card_reviewed", {
      deck_id: deckId,
      grade: gradeId,
      card_type: gradedCard.type,
      is_new: gradedCard.is_new,
    });
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
            reviewId: typeof response.review_id === "string" ? response.review_id : undefined,
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

  function undo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || busy) return;
    haptics.light();

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
    haptics.light();

    setBusy(true);
    setRedoStack((stack) => stack.slice(0, -1));
    setUndoStack((stack) => [...stack, entry]);
    setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
    const before = { is_new: entry.card.is_new, state: entry.card.state };
    const after = nextStateFields(entry.nextState);
    setCounts((c) => applyReviewToCounts(c, before, after, dayStartHour));
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
        setCounts((c) => revertReviewFromCounts(c, before, after, dayStartHour));
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
      <View style={[styles.root, { paddingTop: headerInset }]}>
      {mediaDeferred>0&&<Text accessibilityLiveRegion="polite" style={styles.deferredNote}>{mediaDeferred} cards are deferred until their media downloads.</Text>}
        <ScreenHeader title={deckName || "Study session"} backFallback="/decks" />
        <SafeAreaView style={styles.center} edges={["bottom"]}>
          <ActivityIndicator color={colors.accent} />
        </SafeAreaView>
      </View>
    );
  }

  const deckMenu = deckActions.entriesFor({
    id: deckId,
    title: rawDeckName,
    // The queue counts what's due, not the deck's size. Above zero keeps Export on.
    cardCount: 1,
  });

  if (!current && queueFailed) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader title={deckName || "Study session"} backFallback="/decks" />
        <LoadError title="Couldn't load this session" onRetry={() => void loadQueue()} />
      </View>
    );
  }

  if (!current) {
    const openDeckSettings = deckMenu
      .flatMap((entry) => (isMenuGroup(entry) ? entry.items : [entry]))
      .find((item) => item.label === "Deck settings")?.onPress;

    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title={deckName || "Study session"}
          backFallback="/decks"
          actions={[
            {
              type: "menu",
              icon: "more",
              sfIcon: "ellipsis",
              label: "Deck actions",
              items: deckMenu,
            },
          ]}
        />
        <SessionComplete
          deckName={deckName}
          stats={stats}
          startedAt={sessionStartedAt}
          newHeldBack={newHeldBack}
          onAgain={() => void loadQueue()}
          onOpenDeckSettings={openDeckSettings}
        />
        {deckActions.sheets}
      </View>
    );
  }

  const progressTotal = sessionCompleted + remainingToday;
  const progress = progressTotal <= 0 ? 1 : Math.min(1, sessionCompleted / progressTotal);
  const activeBucket = cardCountBucket(current);
  const dueRemaining = Math.max(0, counts.due - counts.learning);

  return (
    <View style={[styles.root, { paddingTop: headerInset }]}>
      <ScreenHeader
        title={deckName}
        backFallback="/decks"
        actions={[
          {
            icon: "undo",
            sfIcon: "arrow.uturn.backward",
            label: "Undo",
            disabled: undoStack.length === 0,
            onPress: () => void undo(),
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
                    onPress: () => void redo(),
                  },
                  {
                    label: "Edit card",
                    sfIcon: "pencil",
                    onPress: () => setPanelMode("edit"),
                  },
                  {
                    label: suspending ? "Suspending…" : "Suspend card",
                    sfIcon: "pause.circle",
                    disabled: busy || suspending,
                    onPress: () => void suspendCurrentCard(),
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
              ...deckMenu,
            ],
          },
        ]}
      />

      <ProgressBar value={progress} height={2} style={styles.progressLine} />

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
          <Pressable style={styles.cardBody} onPress={revealAnswer} disabled={revealed || busy}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.questionWrap}
              showsVerticalScrollIndicator={false}
            >
              <StudyCardContent card={current} revealed={revealed} fontScale={fontScale} />
            </ScrollView>
          </Pressable>
        </Animated.View>
      </View>

      <ReviewDock
        revealed={revealed}
        disabled={busy}
        intervals={current.intervals}
        onReveal={revealAnswer}
        onGrade={(gradeId) => void grade(gradeId)}
        bottomInset={insets.bottom}
        footer={
          <ReviewDockFooter>
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
      {deckActions.sheets}
    </View>
  );
}

function SessionComplete({
  deckName,
  stats,
  startedAt,
  newHeldBack,
  onAgain,
  onOpenDeckSettings,
}: {
  deckName: string;
  stats: { again: number; hard: number; good: number; easy: number };
  startedAt: number | null;
  newHeldBack: number;
  onAgain: () => void;
  onOpenDeckSettings?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const total = stats.again + stats.hard + stats.good + stats.easy;
  const minutes = startedAt ? Math.max(1, Math.round((Date.now() - startedAt) / 60_000)) : null;

  return (
    <SafeAreaView style={styles.completeRoot} edges={["bottom"]}>
      <SessionEnd
        title={
          total > 0
            ? `That's ${total} card${total === 1 ? "" : "s"} done`
            : "Nothing to review right now"
        }
        subtitle={
          total > 0 && minutes
            ? `${deckName} · ${minutes} minute${minutes === 1 ? "" : "s"}`
            : deckName
        }
        grades={stats}
        note={
          newHeldBack > 0 ? (
            <View style={styles.heldBackRow}>
              <Icon name="info" size={16} color={colors.due} />
              <Text style={styles.heldBackText}>
                {newHeldBack} new card{newHeldBack === 1 ? " is" : "s are"} waiting for tomorrow
                because of your daily limit.{" "}
                {onOpenDeckSettings ? (
                  <Text
                    accessibilityRole="link"
                    onPress={onOpenDeckSettings}
                    style={styles.heldBackLink}
                  >
                    Deck settings
                  </Text>
                ) : null}
              </Text>
            </View>
          ) : null
        }
        actions={
          <>
            <Button
              variant="primary"
              size="lg"
              label="Study more"
              fullWidth
              onPress={onAgain}
            />
            <Button
              variant="secondary"
              size="lg"
              label="Done"
              fullWidth
              onPress={() => goBackOrReplace("/decks")}
            />
          </>
        }
      />
    </SafeAreaView>
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
  });
}
