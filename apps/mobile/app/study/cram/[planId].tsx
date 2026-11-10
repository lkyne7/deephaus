import type { CramQueueCard, CramQueueResponse, ReviewGrade } from "@deephaus/api-client";
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
import { haptics } from "@/lib/haptics";
import { useStudyLiveActivity } from "@/lib/live-activities/use-study-live-activity";
import { readStoredStudyAudioAutoplay, writeStoredStudyAudioAutoplay } from "@/lib/study/audio-autoplay";
import { useAutoplayCardAudio } from "@/lib/study/use-autoplay-card-audio";
import { useHeaderInset } from "@/lib/header-inset";
import { offlineData } from "@/lib/offline-data";
import { readinessPct } from "@/lib/cram";
import { goBackOrReplace } from "@/lib/navigation";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const GRADE_RATINGS: Record<ReviewGrade, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

const FONT_SCALES = [0.85, 1, 1.15, 1.3];

export default function CramSessionRoute() {
  return (
    <SessionGuard>
      <CramSessionScreen />
    </SessionGuard>
  );
}

function CramSessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerInset = useHeaderInset();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const leaveSession = () =>
    goBackOrReplace({
      pathname: "/cram/[planId]",
      params: { planId },
    });
  const [queueData, setQueueData] = useState<CramQueueResponse | null>(null);
  const [cards, setCards] = useState<CramQueueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refilling, setRefilling] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  // Per-grade counts and start time feed the session's Live Activity.
  const [gradeCounts, setGradeCounts] = useState({ again: 0, hard: 0, good: 0, easy: 0 });
  const [sessionStartedAt, setSessionStartedAt] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const inFlightGradesRef = useRef<Set<number>>(new Set());
  const [budgetBypass, setBudgetBypass] = useState(false);
  const [grading, setGrading] = useState(false);
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

  const current = cards[index] ?? null;
  const fontScale = FONT_SCALES[fontIndex];

  // Dynamic Island / Lock Screen card for the session; tapping it returns here.
  const liveActivityUrl = useMemo(
    () => (planId ? Linking.createURL(`/study/cram/${planId}`) : ""),
    [planId],
  );
  const planName = queueData?.plan.name ?? "Cram session";
  const readiness = queueData ? readinessPct(queueData.readiness_score) : null;
  // `grading` stays true while the queue refills after the last card, so the
  // activity does not end during that gap.
  const sessionComplete = !loading && !refilling && !grading && !current;
  const remainingInSession = Math.max(0, cards.length - index);
  const liveActivityState = useMemo(() => {
    if (!planId || sessionStartedAt == null) return null;
    if (sessionComplete && reviewed === 0) return null;
    return {
      kind: "cram" as const,
      title: planName,
      readiness,
      done: reviewed,
      remaining: remainingInSession,
      grades: gradeCounts,
      startedAt: sessionStartedAt,
      status: sessionComplete ? ("complete" as const) : ("active" as const),
      url: liveActivityUrl,
    };
  }, [
    gradeCounts,
    liveActivityUrl,
    planId,
    planName,
    readiness,
    remainingInSession,
    reviewed,
    sessionComplete,
    sessionStartedAt,
  ]);
  useStudyLiveActivity(liveActivityState);

  useAutoplayCardAudio({
    cardKey: current?.queue_key ?? null,
    questionFields: current?.type === "cloze" ? [current.cloze_text] : [current?.front],
    answerFields: current?.type === "cloze" ? [current.extra] : [current?.back, current?.extra],
    revealed,
    enabled: audioAutoplay,
  });

  useEffect(() => {
    setPanelMode(null);
  }, [current?.queue_key]);

  function updateCurrentCard(updated: StudyCardFields) {
    setCards((prev) =>
      prev.map((c, i) =>
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

  const loadQueue = useCallback(
    async (continuePastBudget = false) => {
      if (!planId) return;
      setLoading(true);
      setLoadError(null);
      try {
        const data = await offlineData.getCramQueue(planId, {
          limit: 50,
          continuePastBudget,
        });
        inFlightGradesRef.current.clear();
        setQueueData(data);
        setCards(data.cards);
        setIndex(0);
        setRevealed(false);
        shownAt.current = Date.now();
        setSessionStartedAt((started) => started ?? (data.cards.length > 0 ? Date.now() : null));
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load the study queue.");
        setQueueData(null);
        setCards([]);
      } finally {
        setLoading(false);
      }
    },
    [planId],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [current?.item_id]);

  function grade(gradeId: ReviewGrade) {
    if (!current || !planId || grading) return;
    const gradedIndex = index;
    // Guard against double-taps; the save runs in the background so the next
    // card's Show Answer isn't blocked on the network round-trip.
    if (inFlightGradesRef.current.has(gradedIndex)) return;
    inFlightGradesRef.current.add(gradedIndex);
    haptics.medium();
    setGrading(true);
    const gradedItem = current;
    const responseMs = Math.min(3_600_000, Math.max(0, Date.now() - shownAt.current));
    const advancingToDone = gradedIndex + 1 >= cards.length;

    // Advance optimistically.
    setRevealed(false);
    setIndex(gradedIndex + 1);
    setReviewed((count) => count + 1);
    setGradeCounts((counts) => ({ ...counts, [gradeId]: counts[gradeId] + 1 }));

    offlineData
      .submitCramReview(planId, {
        item_id: gradedItem.item_id,
        rating: GRADE_RATINGS[gradeId],
        response_ms: responseMs,
      })
      .then(async () => {
        if (advancingToDone) {
          // Refill from the server — more cards may still be due past the
          // session page size or re-scheduled mid-session.
          setRefilling(true);
          try {
            const data = await offlineData.getCramQueue(planId, {
              limit: 50,
              continuePastBudget: budgetBypass,
            });
            setQueueData(data);
            if (data.cards.length > 0) {
              // Re-due items keep the same item_id. Replace the consumed page
              // with the refreshed queue so Again cards can return.
              setCards(data.cards);
              setIndex(0);
              setRevealed(false);
              shownAt.current = Date.now();
            } else {
              // Server confirms nothing left — end the session for real.
              setCards((prev) => prev.slice(0, gradedIndex + 1));
              setIndex(gradedIndex + 1);
            }
          } catch {
            // Refill is best-effort; the review itself succeeded.
          } finally {
            setRefilling(false);
          }
        }
      })
      .catch((e) => {
        const message = e instanceof Error ? e.message : "Unknown error";
        setReviewed((count) => Math.max(0, count - 1));
        setGradeCounts((counts) => ({ ...counts, [gradeId]: Math.max(0, counts[gradeId] - 1) }));
        if (/already reviewed|refresh the queue/i.test(message)) {
          // Stale item version — refresh instead of showing an error.
          void loadQueue();
        } else {
          setIndex(gradedIndex);
          setRevealed(true);
          Alert.alert("Grade failed", message);
        }
      })
      .finally(() => {
        inFlightGradesRef.current.delete(gradedIndex);
        setGrading(false);
      });
  }

  if (loading || refilling) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title={queueData?.plan.name ?? "Cram session"}
          backFallback={{ pathname: "/cram/[planId]", params: { planId } }}
        />
        <SafeAreaView style={styles.center} edges={["bottom"]}>
          <ActivityIndicator color={colors.accent} />
        </SafeAreaView>
      </View>
    );
  }

  if (loadError) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title="Cram session"
          backFallback={{ pathname: "/cram/[planId]", params: { planId } }}
        />
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

  const budgetReached = queueData?.budget_reached ?? false;
  const remaining = queueData?.counts.remaining ?? 0;
  const moreAvailable = remaining > 0;
  const budgetPrompt = budgetReached && moreAvailable && !budgetBypass;

  if (budgetPrompt) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title={queueData?.plan.name ?? "Cram session"}
          backFallback={{ pathname: "/cram/[planId]", params: { planId } }}
        />
        <SafeAreaView style={styles.completeRoot} edges={["bottom"]}>
          <SessionEnd
            title="Daily goal reached"
            subtitle={`${reviewed} card${reviewed === 1 ? "" : "s"} reviewed${
              queueData ? ` · ${readinessPct(queueData.readiness_score)}% ready` : ""
            }`}
            grades={gradeCounts}
            note={
              <Text style={styles.completeHint}>
                You've met today's planned effort. Continuing is optional and won't
                affect normal study.
              </Text>
            }
            actions={
              <>
                <Button
                  variant="primary"
                  size="lg"
                  label="Keep studying"
                  fullWidth
                  onPress={() => {
                    setBudgetBypass(true);
                    void loadQueue(true);
                  }}
                />
                <Button
                  variant="secondary"
                  size="lg"
                  label="Finish for today"
                  fullWidth
                  onPress={leaveSession}
                />
              </>
            }
          />
        </SafeAreaView>
      </View>
    );
  }

  if (!current) {
    return (
      <View style={[styles.root, { paddingTop: headerInset }]}>
        <ScreenHeader
          title={queueData?.plan.name ?? "Cram session"}
          backFallback={{ pathname: "/cram/[planId]", params: { planId } }}
        />
        <SafeAreaView style={styles.completeRoot} edges={["bottom"]}>
          <SessionEnd
            title={
              budgetReached && moreAvailable
                ? "Daily goal reached"
                : reviewed > 0
                  ? `That's ${reviewed} card${reviewed === 1 ? "" : "s"} done`
                  : "Nothing to review right now"
            }
            subtitle={queueData ? `${readinessPct(queueData.readiness_score)}% ready` : undefined}
            grades={gradeCounts}
            note={
              budgetReached && moreAvailable ? (
                <Text style={styles.completeHint}>
                  You've hit today's study budget. You can keep going if you want to get
                  ahead.
                </Text>
              ) : null
            }
            actions={
              <>
                {moreAvailable && (
                  <Button
                    variant="primary"
                    size="lg"
                    label="Keep studying"
                    fullWidth
                    onPress={() => {
                      setBudgetBypass(true);
                      void loadQueue(true);
                    }}
                  />
                )}
                <Button
                  variant={moreAvailable ? "secondary" : "primary"}
                  size="lg"
                  label="Done"
                  fullWidth
                  onPress={leaveSession}
                />
              </>
            }
          />
        </SafeAreaView>
      </View>
    );
  }

  const cramProgress = (index + (revealed ? 0.5 : 0)) / Math.max(1, cards.length);

  return (
    <View style={[styles.root, { paddingTop: headerInset }]}>
      <ScreenHeader
        title={queueData?.plan.name ?? "Cram session"}
        backFallback={{ pathname: "/cram/[planId]", params: { planId } }}
        actions={[
          {
            icon: "sparkles",
            sfIcon: "sparkles",
            label: "Explain",
            // Explain shows the answer, so it waits for the reveal here (Cram has no Hint).
            disabled: !revealed,
            onPress: () => setPanelMode("explain"),
          },
          {
            type: "menu",
            icon: "more",
            sfIcon: "ellipsis",
            label: "Study actions",
            items: [
              {
                label: "Edit card",
                sfIcon: "pencil",
                onPress: () => setPanelMode("edit"),
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

      <ProgressBar value={cramProgress} height={2} style={styles.progressLine} />

      <Pressable
        style={styles.cardBody}
        onPress={() => {
          if (!revealed) {
            haptics.selection();
            setRevealed(true);
          }
        }}
        disabled={revealed || grading}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.questionWrap}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.cardCounter}>
            Card {index + 1} of {cards.length} · {current.is_new ? "New" : "Review"}
          </Text>
          <StudyCardContent card={current} revealed={revealed} fontScale={fontScale} />
        </ScrollView>
      </Pressable>

      <ReviewDock
        revealed={revealed}
        disabled={grading}
        intervals={current.intervals}
        onReveal={() => {
          haptics.selection();
          setRevealed(true);
        }}
        onGrade={(gradeId) => grade(gradeId)}
        bottomInset={insets.bottom}
        footer={
          <ReviewDockFooter>
            <Text style={styles.footerText} numberOfLines={1}>
              {reviewed} reviewed
              {queueData?.today
                ? ` · ${Math.max(0, queueData.today.reviews_remaining - reviewed)} left today`
                : ""}
            </Text>
          </ReviewDockFooter>
        }
      />

      <ExplainSheet
        card={current as StudyCardFields & { id: string }}
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
    cardCounter: {
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
    completeHint: {
      fontSize: 13,
      lineHeight: 19,
      color: colors.fgSecondary,
      textAlign: "center",
    },
  });
}
