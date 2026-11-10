import type { DashboardStats, ExamSummaryDto } from "@deephaus/api-client";
import type { Project } from "@deephaus/shared";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import { useDeckActions } from "@/components/deck-actions";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { NativeContextMenu } from "@/components/ui/native-menu";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useAuth } from "@/lib/auth-context";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import { homeStudy, welcomeLine, type HomeStudy } from "@/lib/home-review";
import { offlineData } from "@/lib/offline-data";
import { recentDecks, type RecentDeck } from "@/lib/recent-decks";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Deck buttons under Study: the most recent decks with cards waiting. */
const STUDY_BUTTONS = 2;

// One timing family for Home, on UIKit's deceleration curve, so the welcome
// glides rather than jumps when the composer takes focus or the buttons go.
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
  return "Could not reach the API. Make sure the web server is running.";
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
 * space, with one Study button for everything there is today and buttons for
 * the most recent decks right under it. While the composer has focus the
 * buttons step aside and the welcome glides up with the keyboard. Studying
 * always opens its own screen.
 */
export function HomeOverview({ home, composing = false }: { home: HomeStats; composing?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const { stats, setStats, projects, exams, loading, loadError, retry } = home;

  const profileName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    (user?.user_metadata?.name as string | undefined)?.trim() ||
    "";
  const firstName = profileName.split(/\s+/).filter(Boolean)[0] ?? "";

  const deckActions = useDeckActions({
    onRenamed: (deck, name) =>
      setStats((prev) =>
        prev
          ? {
              ...prev,
              per_deck: prev.per_deck.map((d) => (d.deck_id === deck.id ? { ...d, name } : d)),
            }
          : prev,
      ),
    onDuplicated: () => home.refresh(),
    onDeleted: (deckId) =>
      setStats((prev) =>
        prev
          ? { ...prev, per_deck: prev.per_deck.filter((d) => d.deck_id !== deckId) }
          : prev,
      ),
  });

  const studyDecks = useMemo(
    () =>
      recentDecks(projects, stats)
        .filter((deck) => deck.due + deck.fresh > 0)
        .slice(0, STUDY_BUTTONS),
    [projects, stats],
  );
  // From deck data alone until the exam list arrives, then with what it adds.
  const study = useMemo(() => (stats ? homeStudy(stats, exams ?? []) : null), [stats, exams]);

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

        {composing || !study?.hasWork ? null : (
          <Animated.View entering={FADE_IN} exiting={FADE_OUT} style={styles.studyList}>
            <StudyAllButton study={study} />
            {studyDecks.map((deck) => (
              <NativeContextMenu
                key={deck.id}
                label={deck.title}
                entries={deckActions.entriesFor({
                  id: deck.id,
                  title: deck.title,
                  cardCount: deck.due + deck.fresh,
                })}
              >
                {({ onLongPress }) => <StudyButton deck={deck} onLongPress={onLongPress} />}
              </NativeContextMenu>
            ))}
          </Animated.View>
        )}
      </Animated.View>
      {deckActions.sheets}
    </View>
  );
}

/** One tap from Home into everything there is to study today, exams first. */
function StudyAllButton({ study }: { study: HomeStudy }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const count = `${study.ready} card${study.ready === 1 ? "" : "s"}`;
  return (
    <View style={styles.studyAll}>
      <PressableScale
        onPress={() => {
          haptics.light();
          router.push("/study/all");
        }}
        accessibilityRole="button"
        accessibilityLabel={`Study, ${count}`}
        accessibilityHint={study.line}
        style={styles.studyMain}
      >
        <Icon name="play" size={13} color={colors.actionPrimaryFg} />
        <Text style={styles.studyMainLabel}>Study</Text>
        <Text style={styles.studyMainCount}>{count}</Text>
      </PressableScale>
      <Text style={styles.studyLine} numberOfLines={1}>
        {study.line}
      </Text>
    </View>
  );
}

/** One tap from Home into studying a recent deck. */
function StudyButton({ deck, onLongPress }: { deck: RecentDeck; onLongPress?: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const count = deck.due > 0 ? `${deck.due} due` : `${deck.fresh} new`;
  return (
    <PressableScale
      onPress={() => {
        haptics.light();
        router.push(`/study/${deck.id}`);
      }}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`Study ${deck.title}, ${count}`}
      style={styles.study}
    >
      <Icon name="play" size={13} color={colors.accent} />
      <Text style={styles.studyName} numberOfLines={1}>
        {deck.title}
      </Text>
      <Text style={styles.studyCount}>{count}</Text>
    </PressableScale>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "center" },
    loading: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 40 },
    errorCard: { alignItems: "center", gap: 4 },
    errorTitle: {
      marginTop: 12,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    errorBody: { fontSize: 14, lineHeight: 20, color: colors.fgTertiary, textAlign: "center" },
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
    streak: { flexDirection: "row", alignItems: "center", gap: 5, minHeight: 24 },
    streakText: { fontSize: 13, lineHeight: 18, fontWeight: "500", color: colors.fgTertiary },
    studyList: { alignItems: "center", gap: 8, marginTop: 12, alignSelf: "stretch" },
    studyAll: { alignItems: "center", gap: 6, alignSelf: "stretch", marginBottom: 4 },
    // The one filled button on Home: the day's whole session.
    studyMain: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      maxWidth: 320,
      minHeight: 48,
      paddingHorizontal: 22,
      borderRadius: radius.pill,
      backgroundColor: colors.actionPrimaryBg,
    },
    studyMainLabel: {
      fontSize: 16,
      lineHeight: 21,
      fontWeight: "600",
      color: colors.actionPrimaryFg,
    },
    studyMainCount: {
      fontSize: 14,
      lineHeight: 19,
      color: colors.actionPrimaryFg,
      opacity: 0.72,
    },
    studyLine: {
      maxWidth: 320,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    study: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      maxWidth: 320,
      minHeight: 44,
      paddingHorizontal: 18,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    studyName: {
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    studyCount: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    pressed: { opacity: 0.6 },
  });
}
