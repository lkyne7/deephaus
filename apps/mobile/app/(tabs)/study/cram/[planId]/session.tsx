import type { CramQueueCard, CramQueueResponse, ReviewGrade } from "@deephaus/api-client";
import { parseCardContent, parseImageOcclusionData } from "@deephaus/shared";
import { router, useLocalSearchParams } from "expo-router";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { PageHeader } from "@/components/ui/page-header";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { RichCardContent } from "@/components/rich-card-content";
import { api } from "@/lib/api";
import { readinessPct } from "@/lib/cram";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const GRADE_RATINGS: Record<ReviewGrade, 1 | 2 | 3 | 4> = {
  again: 1,
  hard: 2,
  good: 3,
  easy: 4,
};

function getGrades(colors: ThemeColors): Array<{ id: ReviewGrade; label: string; color: string }> {
  return [
    { id: "again", label: "Again", color: colors.gradeAgain },
    { id: "hard", label: "Hard", color: colors.gradeHard },
    { id: "good", label: "Good", color: colors.gradeGood },
    { id: "easy", label: "Easy", color: colors.gradeEasy },
  ];
}

const PRIMARY_ROW_HEIGHT = 72;

export default function CramSessionScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const grades = useMemo(() => getGrades(colors), [colors]);
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const [queueData, setQueueData] = useState<CramQueueResponse | null>(null);
  const [cards, setCards] = useState<CramQueueCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refilling, setRefilling] = useState(false);
  const [reviewed, setReviewed] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const shownAt = useRef(Date.now());
  const inFlightGradesRef = useRef<Set<number>>(new Set());
  const [budgetBypass, setBudgetBypass] = useState(false);

  const current = cards[index] ?? null;

  const loadQueue = useCallback(
    async (continuePastBudget = false) => {
      if (!planId) return;
      setLoading(true);
      setLoadError(null);
      try {
        const data = await api.getCramQueue(planId, {
          limit: 50,
          continuePastBudget: continuePastBudget || budgetBypass,
        });
        inFlightGradesRef.current.clear();
        setQueueData(data);
        setCards(data.cards);
        setIndex(0);
        setRevealed(false);
        shownAt.current = Date.now();
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : "Could not load the study queue.");
        setQueueData(null);
        setCards([]);
      } finally {
        setLoading(false);
      }
    },
    [planId, budgetBypass],
  );

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [current?.item_id]);

  function grade(gradeId: ReviewGrade) {
    if (!current || !planId) return;
    const gradedIndex = index;
    // Guard against double-taps; the save runs in the background so the next
    // card's Show Answer isn't blocked on the network round-trip.
    if (inFlightGradesRef.current.has(gradedIndex)) return;
    inFlightGradesRef.current.add(gradedIndex);
    const gradedItem = current;
    const responseMs = Math.min(3_600_000, Math.max(0, Date.now() - shownAt.current));
    const advancingToDone = gradedIndex + 1 >= cards.length;

    // Advance optimistically.
    setRevealed(false);
    setIndex(gradedIndex + 1);
    setReviewed((count) => count + 1);

    api
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
            const data = await api.getCramQueue(planId, {
              limit: 50,
              continuePastBudget: budgetBypass,
            });
            if (data.budget_reached && data.cards.length > 0 && !budgetBypass) {
              setBudgetBypass(true);
            }
            setQueueData(data);
            if (data.cards.length > 0) {
              setCards((prev) => {
                const reviewedIds = new Set(prev.slice(0, gradedIndex + 1).map((c) => c.item_id));
                const fresh = data.cards.filter((c) => !reviewedIds.has(c.item_id));
                return [...prev.slice(0, gradedIndex + 1), ...fresh];
              });
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
      });
  }

  if (loading || refilling) {
    return (
      <SafeAreaView style={styles.center} edges={["top", "bottom"]}>
        <ActivityIndicator color={colors.brand500} />
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <View style={styles.root}>
        <PageHeader title="Cram session" onBack={() => router.back()} />
        <View style={styles.center}>
          <FeaturedIcon icon="warning" variant="orange" size="lg" />
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
    const budgetReached = queueData?.budget_reached ?? false;
    const remaining = queueData?.counts.remaining ?? 0;
    const moreAvailable = remaining > reviewed;
    return (
      <SafeAreaView style={styles.completeRoot} edges={["top", "bottom"]}>
        <Card padding={24} style={styles.completeCard}>
          <FeaturedIcon
            icon={budgetReached ? "checkCircle" : "trophy"}
            variant="brand"
            size="2xl"
          />
          <Text style={styles.completeTitle}>
            {budgetReached && moreAvailable ? "Daily goal reached" : "Session complete"}
          </Text>
          <Text style={styles.completeSub}>
            {reviewed} card{reviewed === 1 ? "" : "s"} reviewed
            {queueData ? ` · ${readinessPct(queueData.readiness_score)}% ready` : ""}
          </Text>
          {budgetReached && moreAvailable && (
            <Text style={styles.completeHint}>
              You've hit today's study budget. You can keep going if you want to get
              ahead.
            </Text>
          )}
        </Card>
        <View style={styles.completeActions}>
          {moreAvailable && (
            <Button
              variant="brand"
              size="xl"
              label="Keep studying"
              fullWidth
              onPress={() => {
                setBudgetBypass(true);
                void loadQueue(true);
              }}
            />
          )}
          <Button
            variant={moreAvailable ? "tertiary" : "brand"}
            size={moreAvailable ? "lg" : "xl"}
            label="Done"
            trailingIcon="check"
            fullWidth
            onPress={() => router.back()}
          />
        </View>
      </SafeAreaView>
    );
  }

  const activeCloze = current.cloze_ord ?? undefined;

  return (
    <View style={styles.root}>
      <PageHeader
        style={styles.header}
        title={queueData?.plan.name ?? "Cram session"}
        onBack={() => router.back()}
      />

      <View style={styles.cardArea}>
        <Card padding={20} style={styles.studyCard}>
          <View style={styles.metaRow}>
            <Text style={styles.cardCounter}>
              Card {index + 1} of {cards.length}
            </Text>
            <Text style={styles.cardCounter}>
              {current.is_new ? "New" : "Review"}
            </Text>
          </View>

          <Pressable
            style={styles.cardBody}
            onPress={() => !revealed && setRevealed(true)}
            disabled={revealed}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.questionWrap}
              showsVerticalScrollIndicator={false}
              scrollEnabled={revealed}
            >
              {current.type === "image-occlusion" ? (
                <>
                  {parseCardContent(current.front ?? "")
                    .filter(
                      (segment) =>
                        segment.type === "text" && segment.value.trim().length > 0,
                    )
                    .map((segment, i) => (
                      <Text key={i} style={styles.occlusionHeader}>
                        {segment.type === "text" ? segment.value.trim() : ""}
                      </Text>
                    ))}
                  <OcclusionRenderer
                    data={parseImageOcclusionData(current.occlusion_data)}
                    activeOrd={activeCloze}
                    revealed={revealed}
                    studyView
                    imageHeight={240}
                  />
                  {revealed && (current.back || current.extra) ? (
                    <>
                      <View style={styles.answerDivider} />
                      <RichCardContent content={current.back ?? current.extra} studyView />
                    </>
                  ) : null}
                </>
              ) : current.type === "basic" ? (
                <>
                  <RichCardContent content={current.front} studyView />
                  {revealed && current.back && (
                    <>
                      <View style={styles.answerDivider} />
                      <RichCardContent content={current.back} studyView />
                    </>
                  )}
                  {revealed && current.extra && <RichCardContent content={current.extra} />}
                </>
              ) : (
                <>
                  <RichCardContent
                    content={current.cloze_text}
                    clozeMode={revealed ? "revealed" : "hidden"}
                    activeClozeOrd={activeCloze}
                    studyView
                  />
                  {revealed && current.extra && <RichCardContent content={current.extra} />}
                </>
              )}
            </ScrollView>
          </Pressable>

          <View style={styles.progressTrack}>
            <View
              style={[
                styles.progressFill,
                {
                  width: `${((index + (revealed ? 0.5 : 0)) / Math.max(1, cards.length)) * 100}%`,
                },
              ]}
            />
          </View>
        </Card>
      </View>

      <View style={[styles.footerShell, { paddingBottom: insets.bottom }]}>
        <View style={styles.primaryRow}>
          {revealed ? (
            <View style={styles.gradeRow}>
              {grades.map((g, i) => (
                <Pressable
                  key={g.id}
                  onPress={() => grade(g.id)}
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
              onPress={() => setRevealed(true)}
              style={({ pressed }) => [styles.showAnswerBtn, pressed && { opacity: 0.92 }]}
            >
              <Text style={styles.showAnswerText}>Show Answer</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.footerBar}>
          <Text style={styles.footerText}>
            {reviewed} reviewed
            {queueData?.today
              ? ` · ${Math.max(0, queueData.today.reviews_remaining - reviewed)} left today`
              : ""}
          </Text>
        </View>
      </View>
    </View>
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
      padding: 24,
    },
    stateBody: {
      fontSize: 14,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 12,
    },
    cardArea: {
      flex: 1,
      minHeight: 0,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 12,
    },
    studyCard: {
      flex: 1,
      minHeight: 0,
      gap: 0,
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
    occlusionHeader: {
      fontSize: 17,
      color: colors.fgPrimary,
      lineHeight: 24,
      marginBottom: 12,
      textAlign: "center",
    },
    answerDivider: {
      height: 1,
      backgroundColor: colors.borderSecondary,
      marginVertical: 20,
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
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
    },
    primaryRow: {
      height: PRIMARY_ROW_HEIGHT,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
    },
    gradeRow: {
      flexDirection: "row",
      height: PRIMARY_ROW_HEIGHT,
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
      height: PRIMARY_ROW_HEIGHT,
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
    footerBar: {
      alignItems: "center",
      paddingVertical: 10,
    },
    footerText: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    completeRoot: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
      padding: 20,
      justifyContent: "center",
      gap: 16,
    },
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
    completeHint: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 10,
      borderRadius: radius.lg,
    },
    completeActions: {
      gap: 10,
    },
  });
}
