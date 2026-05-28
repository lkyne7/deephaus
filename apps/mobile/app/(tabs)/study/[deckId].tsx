import type { ReviewCardPayload, ReviewGrade } from "@deephaus/api-client";
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
import { RichCardContent } from "@/components/rich-card-content";
import { StudyCardPanel, type StudyCardFields } from "@/components/study/study-card-panel";
import { StudyOptionsSheet } from "@/components/study/study-options-sheet";
import { api } from "@/lib/api";
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

type HistoryEntry = {
  cardIndex: number;
  card: ReviewCardPayload;
  grade: ReviewGrade;
  previousState: Record<string, unknown> | null;
  nextState: Record<string, unknown>;
  log: Record<string, unknown>;
};

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
  const [deckName, setDeckName] = useState("");
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

  const gradeRef = useRef<(gradeId: ReviewGrade) => Promise<void>>(async () => {});

  const loadQueue = useCallback(async () => {
    if (!deckId) return;
    setLoading(true);
    try {
      const data = await api.getStudyQueue(deckId, { limit: 50 });
      setQueue(data.cards);
      setDeckName(data.deck.name);
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

  useEffect(() => {
    swipeX.setValue(0);
  }, [index, swipeX]);

  useEffect(() => {
    setPanelMode(null);
    setOptionsOpen(false);
  }, [current?.queue_key]);

  const sessionStats = useMemo(() => {
    const learning = queue.filter((c) => c.state === 1 || c.state === 3).length;
    const newCount = queue.filter((c) => c.is_new || c.state === 0).length;
    const due = queue.filter((c) => c.state === 2).length;
    return { learning, new: newCount, due };
  }, [queue]);

  async function grade(gradeId: ReviewGrade) {
    if (!current || busy) return;
    setBusy(true);
    const gradedIndex = index;
    const gradedCard = current;
    setRevealed(false);
    swipeX.setValue(0);
    setStats((s) => ({ ...s, [gradeId]: s[gradeId] + 1 }));
    if (gradedIndex + 1 >= queue.length) {
      setIndex(queue.length);
    } else {
      setIndex(gradedIndex + 1);
    }

    try {
      const response = await api.submitReview(current.id, {
        grade: gradeId,
        cloze_ord: current.cloze_ord ?? undefined,
      });
      setUndoStack((stack) => [
        ...stack,
        {
          cardIndex: gradedIndex,
          card: gradedCard,
          grade: gradeId,
          previousState: (response.previous_state as Record<string, unknown> | null) ?? null,
          nextState: (response.next_state as Record<string, unknown>) ?? {},
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
    } catch (e) {
      setStats((s) => ({ ...s, [gradeId]: Math.max(0, s[gradeId] - 1) }));
      setIndex(gradedIndex);
      setRevealed(true);
      Alert.alert("Grade failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
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

  async function undo() {
    const entry = undoStack[undoStack.length - 1];
    if (!entry || busy) return;
    setBusy(true);
    try {
      await api.restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.previousState,
        log_action: "delete_latest",
      });
      setUndoStack((stack) => stack.slice(0, -1));
      setRedoStack((stack) => [...stack, entry]);
      setStats((s) => ({ ...s, [entry.grade]: Math.max(0, s[entry.grade] - 1) }));
      setIndex(entry.cardIndex);
      setRevealed(true);
    } catch (e) {
      Alert.alert("Undo failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function redo() {
    const entry = redoStack[redoStack.length - 1];
    if (!entry || busy) return;
    setBusy(true);
    try {
      await api.restoreReview(entry.card.id, {
        cloze_ord: entry.card.cloze_ord ?? 0,
        review_state: entry.nextState,
        log_action: "insert",
        log: entry.log,
      });
      setRedoStack((stack) => stack.slice(0, -1));
      setUndoStack((stack) => [...stack, entry]);
      setStats((s) => ({ ...s, [entry.grade]: s[entry.grade] + 1 }));
      setRevealed(false);
      if (entry.cardIndex + 1 >= queue.length) {
        setIndex(queue.length);
      } else {
        setIndex(entry.cardIndex + 1);
      }
    } catch (e) {
      Alert.alert("Redo failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
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
      await api.suspendCard(current.id, true);
      setRevealed(false);
      setQueue((q) => {
        const next = q.filter((_, i) => i !== suspendedIndex);
        if (next.length === 0) {
          setIndex(0);
        } else if (suspendedIndex >= next.length) {
          setIndex(next.length - 1);
        }
        return next;
      });
    } catch (e) {
      Alert.alert("Suspend failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSuspending(false);
    }
  }

  if (loading) {
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

  const stateLabel = stateBadge(colors, current.state);
  const activeCloze = current.cloze_ord ?? undefined;

  return (
    <View style={styles.root}>
      <PageHeader
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
            <View style={styles.metaRow}>
              <Text style={styles.cardCounter}>
                Card {index + 1} of {queue.length}
              </Text>
              <View style={[styles.statePill, { backgroundColor: stateLabel.bg, borderColor: stateLabel.border }]}>
                <View style={[styles.stateDot, { backgroundColor: stateLabel.fg }]} />
                <Text style={[styles.statePillText, { color: stateLabel.fg }]}>{stateLabel.label}</Text>
              </View>
            </View>

            <Pressable style={styles.cardBody} onPress={revealAnswer} disabled={revealed || busy}>
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.questionWrap}
                showsVerticalScrollIndicator={false}
                scrollEnabled={revealed}
              >
                {current.type === "basic" ? (
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

            {current.tags && current.tags.length > 0 && (
              <View style={styles.tagsRow}>
                {current.tags.slice(0, 3).map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  {
                    width: `${((index + (revealed ? 0.5 : 0)) / Math.max(1, queue.length)) * 100}%`,
                  },
                ]}
              />
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
              style={[
                styles.historyBtn,
                (undoStack.length === 0 || busy) && styles.historyBtnDisabled,
              ]}
            >
              <Icon name="undo" size={16} color={colors.fgSecondary} />
              <Text style={styles.historyBtnText}>Undo</Text>
            </Pressable>

            <View style={styles.statusCounts}>
              <Text style={styles.statusText}>
                <Text style={styles.statusOrange}>{sessionStats.learning}</Text> learning
              </Text>
              <Text style={styles.statusDot}>·</Text>
              <Text style={styles.statusText}>
                <Text style={styles.statusOrange}>{sessionStats.due}</Text> due
              </Text>
              <Text style={styles.statusDot}>·</Text>
              <Text style={styles.statusText}>
                <Text style={styles.statusBrand}>{sessionStats.new}</Text> new
              </Text>
            </View>

            <Pressable
              onPress={() => void redo()}
              disabled={redoStack.length === 0 || busy}
              style={[
                styles.historyBtn,
                styles.historyBtnRight,
                (redoStack.length === 0 || busy) && styles.historyBtnDisabled,
              ]}
            >
              <Text style={styles.historyBtnText}>Redo</Text>
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
          pill
          label="Done"
          trailingIcon="check"
          fullWidth
          onPress={() => router.back()}
        />
        <Button
          variant="tertiary"
          size="lg"
          pill
          label="Study more cards"
          fullWidth
          onPress={onAgain}
        />
      </View>
    </SafeAreaView>
  );
}

function stateBadge(colors: ThemeColors, state: number) {
  switch (state) {
    case 1:
    case 3:
      return {
        label: "Learning",
        fg: colors.orange700,
        bg: colors.orange50,
        border: colors.orange200,
      };
    case 2:
      return {
        label: "Review",
        fg: colors.brand700,
        bg: colors.brand50,
        border: colors.brand200,
      };
    case 0:
    default:
      return {
        label: "New",
        fg: colors.gray700,
        bg: colors.gray100,
        border: colors.gray200,
      };
  }
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
      backgroundColor: colors.bgCanvas,
    },
    cardArea: {
      flex: 1,
      paddingHorizontal: 16,
      paddingVertical: 16,
      position: "relative",
    },
    swipeTint: {
      position: "absolute",
      top: 16,
      left: 16,
      right: 16,
      bottom: 16,
      borderRadius: radius.xl,
    },
    swipeTintAgain: {
      backgroundColor: colors.gradeAgain,
    },
    swipeTintGood: {
      backgroundColor: colors.gradeGood,
    },
    studyCard: {
      flex: 1,
      gap: 0,
    },
    cardBody: {
      flex: 1,
    },
    metaRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    cardCounter: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgQuaternary,
      fontWeight: "500",
      letterSpacing: 0.2,
    },
    statePill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 3,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderRadius: radius.pill,
    },
    stateDot: {
      width: 6,
      height: 6,
      borderRadius: 999,
    },
    statePillText: {
      fontSize: 11,
      fontWeight: "600",
      letterSpacing: 0.4,
      textTransform: "uppercase",
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
    tagsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      justifyContent: "center",
      marginBottom: 14,
    },
    tag: {
      paddingVertical: 3,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: "rgba(79,179,177,0.15)",
    },
    tagText: {
      fontSize: 11,
      fontWeight: "500",
      color: colors.brand700,
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
      paddingHorizontal: 16,
      paddingVertical: 8,
      minHeight: REVIEW_PRIMARY_ROW_HEIGHT,
      gap: 8,
    },
    historyBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      minWidth: 72,
    },
    historyBtnRight: {
      justifyContent: "flex-end",
      marginLeft: "auto",
    },
    historyBtnDisabled: {
      opacity: 0.4,
    },
    historyBtnText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    reviewPrimaryRow: {
      height: REVIEW_PRIMARY_ROW_HEIGHT,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
    },
    gradeRow: {
      flexDirection: "row",
      height: REVIEW_PRIMARY_ROW_HEIGHT,
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
      backgroundColor: "#344054",
    },
    showAnswerText: {
      fontSize: 16,
      lineHeight: 20,
      fontWeight: "500",
      color: "#FFFFFF",
    },
    statusCounts: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      flexWrap: "wrap",
      gap: 8,
    },
    statusText: {
      fontSize: 12,
      color: colors.fgTertiary,
      fontWeight: "500",
    },
    statusDot: {
      color: colors.gray300,
    },
    statusOrange: {
      color: colors.orange700,
      fontWeight: "600",
    },
    statusBrand: {
      color: colors.brand700,
      fontWeight: "600",
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
      borderRadius: radius.xl,
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
