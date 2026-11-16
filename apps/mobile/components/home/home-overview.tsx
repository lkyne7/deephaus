import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import type { Project } from "@deephaus/shared";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";
import { UpNextCardView, UpNextRows } from "@/components/home/up-next";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/auth-context";
import { useBackgroundTasks, type BackgroundTask } from "@/lib/background-tasks-context";
import { deckDisplayName } from "@/lib/deck-name";
import { serifFont } from "@/lib/fonts";
import { homeStudy, welcomeLine } from "@/lib/home-review";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { MAX_LINK_ROWS, upNext } from "@/lib/up-next";

/**
 * Up next on a short phone (an iPhone SE is 667 points): fewer rows, and below
 * this no card preview, so the card and its rows fit above the composer.
 */
const SHORT_SCREEN = 700;
const MEDIUM_SCREEN = 820;

export { HOME_MOTION } from "@/components/home/home-motion";

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
    /** Loads again without a spinner, after something here changed the numbers. */
    reload: () => load(),
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
 * Fades a block on Home as the keyboard slides the page up and the block passes
 * under the floating bar. `shift` is how far the page has moved.
 */
function useFadeUnderBar(shift: SharedValue<number> | undefined) {
  const top = useSharedValue(0);
  const height = useSharedValue(0);
  const style = useAnimatedStyle(() => {
    const y = top.value + (shift?.value ?? 0);
    return { opacity: interpolate(y, [-height.value * 0.6, 8], [0, 1], "clamp") };
  });
  return {
    style,
    onLayout: (event: { nativeEvent: { layout: { y: number; height: number } } }) => {
      top.value = event.nativeEvent.layout.y;
      height.value = event.nativeEvent.layout.height;
    },
  };
}

/**
 * Home above the composer: a short welcome, then Up next, all low on the screen
 * where a thumb reaches it. The card offers one thing to do now: learn the
 * cards just made, today's study, or a finished day. Under it, cards being made
 * and other ways into study. Studying always opens its own screen.
 *
 * `shift` is how far Home has slid the page up with the keyboard; blocks fade
 * as they rise under the bar. `writing` fades the card and rows while the
 * composer has the cursor or something in it, leaving a clear page for writing.
 */
export function HomeOverview({
  home,
  shift,
  writing = false,
  finishing,
  madeDecks,
  onRetryTask,
  onDismissTask,
}: {
  home: HomeStats;
  shift?: SharedValue<number>;
  writing?: boolean;
  /** Runs that just finished here, shown as done until the card takes them over. */
  finishing?: ReadonlySet<string>;
  /** Names of decks just made here, which the deck list may not have yet. */
  madeDecks?: ReadonlyMap<string, string>;
  onRetryTask: (task: BackgroundTask) => void;
  onDismissTask: (task: BackgroundTask) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const { tasks, recentRuns } = useBackgroundTasks();
  const { stats, projects, exams, loading, loadError, retry } = home;
  const { height: screenHeight } = useWindowDimensions();
  const compact = screenHeight < SHORT_SCREEN;
  const maxLinks = compact ? 1 : screenHeight < MEDIUM_SCREEN ? 2 : MAX_LINK_ROWS;

  const profileName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    (user?.user_metadata?.name as string | undefined)?.trim() ||
    "";
  const firstName = profileName.split(/\s+/).filter(Boolean)[0] ?? "";

  const deckNames = useMemo(
    () =>
      new Map([
        ...(madeDecks ?? []),
        ...projects.map((project) => [project.id, deckDisplayName(project.deck_name || project.name)] as const),
      ]),
    [madeDecks, projects],
  );
  // From deck data alone until the exam list arrives, then with what it adds.
  const plan = useMemo(
    () =>
      stats
        ? upNext({
            stats,
            exams: exams ?? [],
            projects,
            runs: recentRuns,
            tasks,
            finishing,
            deckNames,
            now: Date.now(),
            maxLinks,
          })
        : null,
    [deckNames, exams, finishing, maxLinks, projects, recentRuns, stats, tasks],
  );

  const greetingFade = useFadeUnderBar(shift);
  const cardFade = useFadeUnderBar(shift);

  const hidden = useSharedValue(writing ? 1 : 0);
  useEffect(() => {
    hidden.value = withTiming(writing ? 1 : 0, { duration: 180 });
  }, [hidden, writing]);
  const writingStyle = useAnimatedStyle(() => ({
    opacity: 1 - hidden.value,
    transform: [{ translateY: hidden.value * 6 }],
  }));

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

  if (!stats || !plan) return null;

  const weekday = new Date().toLocaleDateString([], { weekday: "long" });

  return (
    <View style={styles.root}>
      <View style={styles.welcomeSpace}>
        <Animated.View
          entering={FadeIn.duration(320)}
          style={[styles.welcome, greetingFade.style]}
          onLayout={greetingFade.onLayout}
        >
          <View style={styles.dayLine}>
            <Text style={styles.dayText}>{weekday}</Text>
            {stats.streak > 0 ? (
              <Pressable
                onPress={() => router.navigate("/insights")}
                hitSlop={12}
                accessibilityRole="link"
                accessibilityLabel={`${stats.streak}-day streak`}
                accessibilityHint="Opens Insights"
                style={({ pressed }) => [styles.streak, pressed && styles.pressed]}
              >
                <Text style={styles.dayText}>·</Text>
                <Icon name="fire" size={13} color={colors.fgTertiary} />
                <Text style={styles.dayText}>{stats.streak}-day streak</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.welcomeLine} accessibilityRole="header">
            {welcomeLine(new Date().getHours(), firstName, isCaughtUp(stats, exams))}
          </Text>
          <SyncStatusPill />
        </Animated.View>
      </View>

      <Animated.View
        style={[styles.upNext, writingStyle]}
        // The card sits at the top of this block, so this is the card's place too.
        onLayout={cardFade.onLayout}
        pointerEvents={writing ? "none" : "auto"}
        accessibilityElementsHidden={writing}
        importantForAccessibility={writing ? "no-hide-descendants" : "auto"}
      >
        <Animated.View
          entering={FadeIn.duration(360).delay(60)}
          style={cardFade.style}
        >
          <UpNextCardView card={plan.card} compact={compact} />
        </Animated.View>
        <UpNextRows rows={plan.rows} onRetry={onRetryTask} onDismiss={onDismissTask} />
      </Animated.View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, gap: 12 },
    upNext: { gap: 12 },
    // The open space above Up next; the welcome sits at its foot, just over the card.
    welcomeSpace: { flex: 1, justifyContent: "flex-end" },
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
    welcome: { alignItems: "flex-start", gap: 4, paddingHorizontal: 10, paddingTop: 16, paddingBottom: 6 },
    dayLine: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 22 },
    dayText: { fontSize: 14, lineHeight: 19, color: colors.fgTertiary },
    welcomeLine: {
      ...serifFont(),
      fontSize: 32,
      lineHeight: 38,
      letterSpacing: -0.45,
      color: colors.fgPrimary,
    },
    streak: { flexDirection: "row", alignItems: "center", gap: 5 },
    pressed: { opacity: 0.6 },
  });
}
