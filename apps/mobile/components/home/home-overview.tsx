import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import type { Project } from "@deephaus/shared";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { StudyPicker } from "@/components/home/study-picker";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import { homeStudy, welcomeLine } from "@/lib/home-review";
import { offlineData } from "@/lib/offline-data";
import { recentDecks, type RecentDeck } from "@/lib/recent-decks";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** The picker's first entry: everything there is today, exams first. */
const EVERYTHING_ID = "everything";

// One timing family for Home, on UIKit's deceleration curve, so the welcome
// glides rather than jumps when the composer takes focus or the picker goes.
const EASE = Easing.bezier(0.2, 0.9, 0.3, 1);
const LAYOUT = LinearTransition.duration(360).easing(EASE);
const FADE_IN = FadeIn.duration(220);
const FADE_OUT = FadeOut.duration(140);

function getErrorStatus(err: unknown): number | null {
  if (err && typeof err === "object" && "status" in err) {
    const status = (err as { status: unknown }).status;
    return typeof status === "number" ? status : null;
  }
  return null;
}

function formatLoadError(err: unknown): string {
  const status = getErrorStatus(err);
  if (status === 401) {
    return "Session expired. Pull to refresh or sign in again.";
  }
  if (status != null && status >= 500) {
    return "Server error loading your stats. Try again shortly.";
  }
  if (status != null) {
    return "Could not load your stats.";
  }
  return "You're offline or DeepHaus can't be reached. Pull to refresh when you're back online.";
}

/** Loads Home's numbers on mount and whenever the screen regains focus. */
export function useHomeStats() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  // Null until the exam list first arrives. Home never waits on it.
  const [exams, setExams] = useState<ExamSummaryDto[] | null>(null);
  const examsRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadInFlight = useRef(false);

  const load = useCallback(async () => {
    if (!session) return;
    // Mount and the initial navigation focus event both trigger a load;
    // collapse overlapping requests into one.
    if (loadInFlight.current) return;
    loadInFlight.current = true;
    setLoadError(null);
    // Exams only add to the Study button, so they load beside the stats rather
    // than with them, and a failed fetch is no exams.
    const examsAsked = ++examsRequest.current;
    void offlineData
      .listExams()
      .then((result) => result.exams)
      .catch(() => [])
      .then((next) => {
        if (examsAsked === examsRequest.current) setExams(next);
      });
    try {
      // Decks only order the study buttons, so a failure there isn't fatal.
      const [nextStats, nextProjects] = await Promise.all([
        offlineData.getDashboardStats(),
        offlineData.listProjects().catch(() => null),
      ]);
      setStats(nextStats);
      if (nextProjects) setProjects(nextProjects);
    } catch (err) {
      setLoadError(formatLoadError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
      loadInFlight.current = false;
    }
  }, [session]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }
    void load();
    return navigation.addListener("focus", () => {
      void load();
    });
  }, [navigation, load, session]);

  return {
    stats,
    setStats,
    projects,
    exams,
    loading,
    loadError,
    refreshing,
    refresh: () => {
      setRefreshing(true);
      void load();
    },
    retry: () => {
      setLoading(true);
      void load();
    },
  };
}

export type HomeStats = ReturnType<typeof useHomeStats>;

/**
 * Whether today's study is finished, which changes Home's welcome and composer.
 * Cards ready for an exam count as work, even with every deck caught up.
 */
export function isCaughtUp(
  stats: DashboardStats | null,
  exams: readonly ExamSummaryDto[] | null = null,
): boolean {
  return Boolean(stats && stats.per_deck.length > 0 && !homeStudy(stats, exams ?? []).hasWork);
}

/**
 * Home above the composer, as in Claude's app: a welcome centred in the open
 * space, with a picker and Study button right under it. The picker starts on
 * everything there is today (each exam with cards ready, then each deck with
 * work, in one session) and can narrow to a single deck. While the composer
 * has focus the picker steps aside and the welcome glides up with the
 * keyboard. Studying always opens its own screen.
 */
export function HomeOverview({ home, composing = false }: { home: HomeStats; composing?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const { stats, projects, exams, loading, loadError, retry } = home;

  const profileName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    (user?.user_metadata?.name as string | undefined)?.trim() ||
    "";
  const firstName = profileName.split(/\s+/).filter(Boolean)[0] ?? "";

  // From deck data alone until the exam list arrives, then with what it adds.
  const study = useMemo(() => (stats ? homeStudy(stats, exams ?? []) : null), [stats, exams]);
  // Everything first, then decks, most recent first. The picker starts on
  // everything when there is work, and keeps whatever you choose while Home
  // stays open.
  const decks = useMemo(() => {
    const recent = recentDecks(projects, stats);
    if (!stats || !study?.hasWork) return recent;
    const fresh = Math.min(stats.new_today_remaining, study.ready);
    const everything: RecentDeck = {
      id: EVERYTHING_ID,
      title: "Today's cards",
      due: study.ready - fresh,
      fresh,
    };
    return [everything, ...recent];
  }, [projects, stats, study]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const selected =
    decks.find((deck) => deck.id === chosenId) ??
    decks.find((deck) => deck.due + deck.fresh > 0) ??
    decks[0];

  if (loading && !stats) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (loadError && !stats) {
    return (
      <View style={styles.root}>
        <Card padding={20} style={styles.errorCard}>
          <FeaturedIcon icon="warning" variant="gray" size="md" />
          <Text style={styles.errorTitle}>Home isn't available</Text>
          <Text style={styles.errorBody}>{loadError}</Text>
          <Button
            variant="secondary"
            size="md"
            label="Try again"
            onPress={retry}
            style={{ marginTop: 12 }}
          />
        </Card>
      </View>
    );
  }

  if (!stats) return null;

  return (
    <View style={styles.root}>
      {/* The column re-centres whenever its height or the space around it
          changes (buttons leaving, keyboard rising), gliding to its place. */}
      <Animated.View entering={FadeIn.duration(320)} layout={LAYOUT} style={styles.welcome}>
        <BrandMark size={40} />
        <Text style={styles.welcomeLine} accessibilityRole="header">
          {welcomeLine(new Date().getHours(), firstName, isCaughtUp(stats, exams))}
        </Text>
        {stats.streak > 0 ? (
          <Pressable
            onPress={() => router.navigate("/insights")}
            hitSlop={12}
            accessibilityRole="link"
            accessibilityLabel={`${stats.streak}-day streak`}
            accessibilityHint="Opens Insights"
            style={({ pressed }) => [styles.streak, pressed && styles.pressed]}
          >
            <Icon name="fire" size={14} color={colors.fgTertiary} />
            <Text style={styles.streakText}>{stats.streak}-day streak</Text>
          </Pressable>
        ) : null}
        <SyncStatusPill />

        {composing || !selected ? null : (
          <Animated.View entering={FADE_IN} exiting={FADE_OUT} style={styles.studyRow}>
            <StudyPicker
              decks={decks}
              selected={selected}
              onSelect={(deck) => {
                haptics.selection();
                setChosenId(deck.id);
              }}
              onStudy={() => {
                haptics.light();
                router.push(
                  selected.id === EVERYTHING_ID ? "/study/all" : `/study/${selected.id}`,
                );
              }}
            />
            {selected.id === EVERYTHING_ID && study ? (
              <Text style={styles.studyLine} numberOfLines={1}>
                {study.line}
              </Text>
            ) : null}
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "center" },
    loading: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 40,
    },
    errorCard: { alignItems: "center", gap: 4 },
    errorTitle: {
      marginTop: 12,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    errorBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    // Centred in the open space between the bar and the composer, as in Claude's app.
    welcome: { alignItems: "center", gap: 12, paddingVertical: 24 },
    welcomeLine: {
      ...serifFont(),
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.45,
      color: colors.fgPrimary,
      textAlign: "center",
    },
    streak: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minHeight: 24,
    },
    streakText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    studyRow: { alignItems: "center", gap: 8, marginTop: 12, alignSelf: "stretch" },
    // Under the picker while it is on everything: how long, and what is for an exam.
    studyLine: {
      maxWidth: 320,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    pressed: { opacity: 0.6 },
  });
}
