import type { DashboardStats } from "@deephaus/api-client";
import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  LinearTransition,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useDeckActions } from "@/components/deck-actions";
import { pairCardStyle, pairChipStyle } from "@/components/home/pair-card";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { NativeContextMenu } from "@/components/ui/native-menu";
import { PressableScale } from "@/components/ui/pressable-scale";
import { useAuth } from "@/lib/auth-context";
import { deckDisplayName } from "@/lib/deck-name";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import {
  estimateMinutes,
  reviewBreakdown,
  welcomeLine,
  type ReviewDeck,
  type ReviewSegment,
} from "@/lib/home-review";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Decks listed inside the review card. */
const SHORTLIST_SIZE = 3;

// One timing family for Home, so every change moves the same way.
const LAYOUT = LinearTransition.duration(240);
const FADE_IN = FadeIn.duration(180);
const FADE_OUT = FadeOut.duration(120);

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
    try {
      setStats(await offlineData.getDashboardStats());
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

/** Whether today's review is finished, which changes Home's welcome and composer. */
export function isCaughtUp(stats: DashboardStats | null): boolean {
  return Boolean(
    stats && stats.per_deck.length > 0 && stats.due_now + stats.new_today_remaining === 0,
  );
}

/**
 * Home above the composer: a centred welcome in the open space, then today's
 * review as a card that pairs with the composer docked under it. Studying
 * always opens its own screen.
 */
export function HomeOverview({ home, composing = false }: { home: HomeStats; composing?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const { stats, setStats, loading, loadError, retry } = home;

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
      <Animated.View entering={FadeIn.duration(320)} layout={LAYOUT} style={styles.welcome}>
        <BrandMark size={40} />
        <Text style={styles.welcomeLine} accessibilityRole="header">
          {welcomeLine(new Date().getHours(), firstName, isCaughtUp(stats))}
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
      </Animated.View>

      {/* While writing, Home is only the welcome and the composer, like a new chat. */}
      {composing ? null : <ReviewCard stats={stats} deckActions={deckActions} />}
      {deckActions.sheets}
    </View>
  );
}

function ReviewCard({
  stats,
  deckActions,
}: {
  stats: DashboardStats;
  deckActions: ReturnType<typeof useDeckActions>;
}) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const review = useMemo(() => reviewBreakdown(stats), [stats]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = review.decks.find((deck) => deck.id === selectedId) ?? null;
  // A deck that was picked and then finished elsewhere falls back to all decks.
  useEffect(() => {
    if (selectedId && !selected) setSelectedId(null);
  }, [selectedId, selected]);

  const shortlist = review.decks.slice(0, SHORTLIST_SIZE);
  // There's no review across decks yet, so Start opens the deck with the most
  // waiting unless one is picked.
  const target = selected ?? review.decks[0] ?? null;
  const card = [pairCardStyle(colors), shadows.sm];

  function pick(deck: ReviewDeck) {
    haptics.selection();
    setSelectedId((current) => (current === deck.id ? null : deck.id));
  }

  if (review.ready === 0) {
    return (
      <Animated.View entering={FADE_IN} exiting={FADE_OUT} layout={LAYOUT} style={[card, styles.compact]}>
        <View style={styles.compactText}>
          <Text style={styles.compactTitle}>All caught up</Text>
          <Text style={styles.meta}>
            {review.done > 0
              ? `${review.done.toLocaleString()} reviewed today`
              : "Nothing due right now"}
          </Text>
        </View>
        <PressableScale
          onPress={() => router.navigate("/cram")}
          accessibilityRole="button"
          style={pairChipStyle(colors)}
        >
          <Icon name="bolt" size={15} color={colors.fgSecondary} />
          <Text style={styles.chipLabel}>Cram</Text>
        </PressableScale>
      </Animated.View>
    );
  }

  const count = selected ? selected.due + selected.fresh : review.ready;

  return (
    <Animated.View entering={FADE_IN} exiting={FADE_OUT} layout={LAYOUT} style={card} accessibilityLabel="Today's review">
      <View style={styles.head}>
        <Animated.Text
          key={selected?.id ?? "all"}
          entering={FADE_IN}
          exiting={FADE_OUT}
          style={styles.title}
          numberOfLines={1}
        >
          {selected
            ? deckDisplayName(selected.name)
            : `${review.ready.toLocaleString()} card${review.ready === 1 ? "" : "s"} ready`}
        </Animated.Text>
        <Text style={styles.meta}>About {estimateMinutes(count)}</Text>
      </View>

      <View
        style={styles.bar}
        accessible
        accessibilityRole="image"
        accessibilityLabel={`${review.done} done, ${review.due} due, ${review.fresh} new`}
      >
        {review.segments.map((segment) => (
          <BarSegment
            key={segment.key}
            segment={segment}
            dimmed={selected != null && segment.deckId !== selected.id}
          />
        ))}
      </View>

      <View>
        {shortlist.map((deck) => (
          <NativeContextMenu
            key={deck.id}
            label={deckDisplayName(deck.name)}
            entries={deckActions.entriesFor({
              id: deck.id,
              title: deckDisplayName(deck.name),
              cardCount: deck.due + deck.fresh,
            })}
          >
            {({ onLongPress }) => (
              <DeckRow
                deck={deck}
                selected={deck.id === selected?.id}
                onPress={() => pick(deck)}
                onLongPress={onLongPress}
              />
            )}
          </NativeContextMenu>
        ))}
      </View>

      <View style={styles.tools}>
        <PressableScale
          onPress={() => router.navigate("/decks")}
          accessibilityRole="button"
          style={pairChipStyle(colors)}
        >
          <Text style={styles.chipLabel}>All decks</Text>
        </PressableScale>
        <PressableScale
          onPress={() => router.navigate("/cram")}
          accessibilityRole="button"
          style={pairChipStyle(colors)}
        >
          <Icon name="bolt" size={15} color={colors.fgSecondary} />
          <Text style={styles.chipLabel}>Cram</Text>
        </PressableScale>
        <PressableScale
          onPress={() => {
            if (!target) return;
            haptics.light();
            router.push(`/study/${target.id}`);
          }}
          disabled={!target}
          accessibilityRole="button"
          accessibilityLabel={selected ? `Start ${deckDisplayName(selected.name)}` : "Start review"}
          accessibilityHint={target ? `Opens ${deckDisplayName(target.name)}` : undefined}
          style={styles.start}
        >
          <Text style={styles.startLabel}>{selected ? `Start · ${count}` : "Start"}</Text>
          <Icon name="arrowRightSmall" size={16} color={colors.actionBrandFg} />
        </PressableScale>
      </View>
    </Animated.View>
  );
}

/** One slice of the bar; it fades when another deck is picked. */
function BarSegment({ segment, dimmed }: { segment: ReviewSegment; dimmed: boolean }) {
  const { colors } = useTheme();
  const opacity = useSharedValue(1);
  useEffect(() => {
    opacity.value = withTiming(dimmed ? 0.25 : 1, { duration: 200 });
  }, [dimmed, opacity]);
  const animated = useAnimatedStyle(() => ({ opacity: opacity.value }));
  const color =
    segment.kind === "done"
      ? colors.accent
      : segment.kind === "due"
        ? colors.dueDot
        : colors.bgActive;
  return (
    <Animated.View
      style={[{ flexGrow: segment.value, flexBasis: 0, borderRadius: 4, backgroundColor: color }, animated]}
    />
  );
}

/** A deck inside the review card; picking it points Start at that deck. */
function DeckRow({
  deck,
  selected,
  onPress,
  onLongPress,
}: {
  deck: ReviewDeck;
  selected: boolean;
  onPress: () => void;
  onLongPress?: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tint = useSharedValue(selected ? 1 : 0);
  useEffect(() => {
    tint.value = withTiming(selected ? 1 : 0, { duration: 180 });
  }, [selected, tint]);
  const highlight = useAnimatedStyle(() => ({ opacity: tint.value }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`${deckDisplayName(deck.name)}, ${deck.due > 0 ? `${deck.due} due` : `${deck.fresh} new`}`}
      accessibilityHint={selected ? "Shows all decks again" : "Starts with this deck"}
      style={styles.row}
    >
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.rowTint, highlight]} />
      <View style={[styles.dot, { backgroundColor: deck.due > 0 ? colors.dueDot : colors.accent }]} />
      <Text style={styles.rowName} numberOfLines={1}>
        {deckDisplayName(deck.name)}
      </Text>
      <Text style={styles.rowCount}>{deck.due > 0 ? `${deck.due} due` : `${deck.fresh} new`}</Text>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, justifyContent: "flex-end", gap: 8 },
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
    // The welcome takes the open space and sits in its middle, as in Claude's app.
    welcome: { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingVertical: 24 },
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
    head: {
      flexDirection: "row",
      alignItems: "baseline",
      justifyContent: "space-between",
      gap: 10,
      paddingHorizontal: 6,
    },
    title: {
      ...serifFont(),
      flexShrink: 1,
      fontSize: 24,
      lineHeight: 30,
      letterSpacing: -0.25,
      color: colors.fgPrimary,
    },
    meta: { fontSize: 14, lineHeight: 18, color: colors.fgTertiary },
    bar: { flexDirection: "row", gap: 3, height: 8, marginHorizontal: 6 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 44,
      paddingHorizontal: 8,
      borderRadius: 14,
      overflow: "hidden",
    },
    rowTint: { backgroundColor: colors.bgSunken, borderRadius: 14 },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    rowName: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, color: colors.fgPrimary },
    rowCount: { fontSize: 14, lineHeight: 18, color: colors.fgTertiary },
    tools: { flexDirection: "row", alignItems: "center", gap: 6 },
    chipLabel: { fontSize: 14, lineHeight: 18, color: colors.fgSecondary },
    start: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      height: 44,
      paddingLeft: 18,
      paddingRight: 14,
      marginLeft: "auto",
      borderRadius: radius.pill,
      backgroundColor: colors.actionBrandBg,
    },
    startLabel: { fontSize: 15, lineHeight: 18, fontWeight: "600", color: colors.actionBrandFg },
    compact: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, paddingLeft: 16 },
    compactText: { flex: 1, minWidth: 0 },
    compactTitle: { fontSize: 16, lineHeight: 21, fontWeight: "600", color: colors.fgPrimary },
    pressed: { opacity: 0.6 },
  });
}
