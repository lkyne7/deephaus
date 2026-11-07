import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { useDeckActions } from "@/components/deck-actions";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon, type IconName } from "@/components/ui/icon";
import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import { NativeContextMenu, NativeMenu } from "@/components/ui/native-menu";
import { useAuth } from "@/lib/auth-context";
import { deckDisplayName } from "@/lib/deck-name";
import { serifFont } from "@/lib/fonts";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DashboardStats } from "@deephaus/api-client";

type DeckStat = DashboardStats["per_deck"][number];

const SHORTLIST_SIZE = 3;

/** Rough per-card review pace used only for the "About N minutes" estimate. */
const SECONDS_PER_CARD = 9;

/** Human-friendly study-time estimate ("About 28 minutes" / "About 2h 30m"). */
function estimateDuration(cards: number): string {
  const minutes = Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

/** Mirrors the web deck grid's relative "Last reviewed" label. */
function formatRelative(s: string | null): string | null {
  if (!s) return null;
  const d = new Date(s);
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

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

function timeGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
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

/**
 * Home above the composer: greeting, today's review and the decks to pick up.
 * Starting a review opens the session over the sidebar, so closing it comes back here.
 */
export function HomeOverview({ home, onCreate }: { home: HomeStats; onCreate: () => void }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { user } = useAuth();
  const { stats, setStats, loading, loadError, retry } = home;

  const profileName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    (user?.user_metadata?.name as string | undefined)?.trim() ||
    "";
  const firstName = profileName.split(/\s+/).filter(Boolean)[0] ?? "";
  const greeting = firstName ? `${timeGreeting()}, ${firstName}` : timeGreeting();

  // There's no review across decks yet, so Start review opens the deck with the
  // most waiting and the card says which one.
  const nextDeck = useMemo(() => {
    const ready = (stats?.per_deck ?? []).filter((d) => d.due + d.new > 0);
    return [...ready].sort((a, b) => b.due - a.due || b.new - a.new)[0] ?? null;
  }, [stats]);

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

  const shortlist = useMemo(() => {
    const all = stats?.per_deck ?? [];
    const waiting = all.filter((d) => d.due > 0).sort((a, b) => b.due - a.due);
    if (waiting.length > 0) return waiting.slice(0, SHORTLIST_SIZE);
    return [...all]
      .sort((a, b) => (b.last_reviewed ?? "").localeCompare(a.last_reviewed ?? ""))
      .slice(0, SHORTLIST_SIZE);
  }, [stats]);
  const shortlistHasDue = shortlist.some((d) => d.due > 0);

  const startDeck = (deckId: string) => router.push(`/study/${deckId}`);
  const deckChoices = useMemo<NativeMenuEntry[]>(
    () =>
      (stats?.per_deck ?? [])
        .filter((d) => d.due + d.new > 0)
        .map((d) => ({
          label: `${deckDisplayName(d.name)} (${d.due} due · ${d.new} new)`,
          onPress: () => router.push(`/study/${d.deck_id}`),
        })),
    [stats],
  );
  const openDeck = (deck: DeckStat) => {
    if (deck.due + deck.new > 0) {
      startDeck(deck.deck_id);
      return;
    }
    router.push(`/decks/${deck.deck_id}`);
  };

  if (loading && !stats) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.content}>
      {loadError && !stats && (
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
      )}

      {stats && (
        <>
          <View style={styles.greetingRow}>
            <BrandMark size={30} />
            <Text style={styles.greeting} accessibilityRole="header">
              {greeting}
            </Text>
            <SyncStatusPill />
          </View>

          <TodayCard
            stats={stats}
            nextDeck={nextDeck}
            onStart={() => nextDeck && startDeck(nextDeck.deck_id)}
            deckChoices={deckChoices}
            onCram={() => router.navigate("/cram")}
            onCreate={onCreate}
          />

          {shortlist.length > 0 && (
            <View>
              <SectionHeader
                title={shortlistHasDue ? "Pick up where you left off" : "Recently studied"}
                actionLabel="All decks"
                onAction={() => router.navigate("/decks")}
              />
              {shortlist.map((deck, index) => (
                <DeckRow
                  key={deck.deck_id}
                  deck={deck}
                  first={index === 0}
                  onPress={() => openDeck(deck)}
                  menu={deckActions.entriesFor({
                    id: deck.deck_id,
                    title: deckDisplayName(deck.name),
                    cardCount: deck.total,
                  })}
                />
              ))}
            </View>
          )}
        </>
      )}

      {deckActions.sheets}
    </View>
  );
}

function TodayCard({
  stats,
  nextDeck,
  onStart,
  deckChoices,
  onCram,
  onCreate,
}: {
  stats: DashboardStats;
  nextDeck: DeckStat | null;
  onStart: () => void;
  deckChoices: NativeMenuEntry[];
  onCram: () => void;
  onCreate: () => void;
}) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const ready = stats.due_now + stats.new_today_remaining;
  const done = stats.reviewed_today;
  const hasDecks = stats.per_deck.length > 0;

  const summary = [
    stats.streak > 0 ? `${stats.streak}-day streak` : null,
    stats.retention_pct != null ? `${Math.round(stats.retention_pct * 100)}% retention` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  if (!hasDecks) {
    return (
      <Card padding={20} style={shadows.xs}>
        <Text style={styles.title}>No decks yet</Text>
        <Text style={styles.sub}>Make your first cards from a topic, notes or a file.</Text>
        <Button
          variant="primary"
          size="lg"
          label="Create a deck"
          onPress={onCreate}
          fullWidth
          style={styles.primary}
        />
      </Card>
    );
  }

  if (ready === 0) {
    return (
      <Card padding={20} style={shadows.xs}>
        <Text style={styles.title}>You're all caught up</Text>
        <Text style={styles.sub}>
          {[`${done.toLocaleString()} reviewed today`, summary].filter(Boolean).join(" · ")}
        </Text>
        <Button
          variant="secondary"
          size="lg"
          label="Cram"
          leadingIcon="bolt"
          onPress={onCram}
          fullWidth
          style={styles.primary}
        />
      </Card>
    );
  }

  return (
    <Card padding={20} style={shadows.xs}>
      <Text style={styles.title}>
        {ready.toLocaleString()} card{ready === 1 ? "" : "s"} ready
      </Text>
      <Text style={styles.sub}>
        About {estimateDuration(ready)}
        {done > 0 ? ` · ${done.toLocaleString()} reviewed already` : ""}
      </Text>

      <SplitBar done={done} due={stats.due_now} fresh={stats.new_today_remaining} />

      <Button
        variant="primary"
        size="lg"
        label="Start review"
        onPress={onStart}
        disabled={!nextDeck}
        accessibilityHint={nextDeck ? `Starts with ${deckDisplayName(nextDeck.name)}` : undefined}
        fullWidth
        style={styles.primary}
      />
      {nextDeck ? (
        <Text style={styles.startsWith} numberOfLines={1}>
          Starts with {deckDisplayName(nextDeck.name)}
        </Text>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.links}>
          <NativeMenu label="Choose a deck" entries={deckChoices}>
            <QuietLabel icon="folder" label="Choose a deck" />
          </NativeMenu>
          <Pressable
            onPress={onCram}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Cram"
            style={({ pressed }) => pressed && { opacity: 0.6 }}
          >
            <QuietLabel icon="bolt" label="Cram" />
          </Pressable>
        </View>
        {summary ? (
          <View style={styles.summaryRow}>
            {stats.streak > 0 ? <Icon name="fire" size={13} color={colors.fgTertiary} /> : null}
            <Text style={styles.summary} numberOfLines={1}>
              {summary}
            </Text>
          </View>
        ) : null}
      </View>
    </Card>
  );
}

function SplitBar({ done, due, fresh }: { done: number; due: number; fresh: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  const segments = [
    { key: "done", value: done, color: colors.accent, label: "done" },
    { key: "due", value: due, color: colors.dueDot, label: "due" },
    { key: "new", value: fresh, color: colors.bgActive, label: "new" },
  ];
  return (
    <View
      accessible
      accessibilityLabel={`${done} done, ${due} due, ${fresh} new`}
      style={styles.split}
    >
      <View style={styles.bar}>
        {segments
          .filter((segment) => segment.value > 0)
          .map((segment) => (
            <View
              key={segment.key}
              style={{ flex: segment.value, backgroundColor: segment.color, borderRadius: 2 }}
            />
          ))}
      </View>
      <View style={styles.legend}>
        {segments.map((segment) => (
          <Text key={segment.key} style={styles.legendItem}>
            <Text style={styles.legendValue}>{segment.value.toLocaleString()}</Text> {segment.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

function QuietLabel({ icon, label }: { icon: IconName; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createTodayStyles(colors), [colors]);
  return (
    <View style={styles.link}>
      <Icon name={icon} size={15} color={colors.fgSecondary} />
      <Text style={styles.linkText}>{label}</Text>
    </View>
  );
}

function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle} accessibilityRole="header">
        {title}
      </Text>
      <Pressable onPress={onAction} hitSlop={8} accessibilityRole="button">
        <Text style={styles.sectionAction}>{actionLabel}</Text>
      </Pressable>
    </View>
  );
}

function DeckRow({
  deck,
  first,
  onPress,
  menu,
}: {
  deck: DeckStat;
  first: boolean;
  onPress: () => void;
  menu: NativeMenuEntry[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const title = deckDisplayName(deck.name);
  const relative = formatRelative(deck.last_reviewed);
  return (
    <NativeContextMenu label={title} entries={menu}>
      {({ onLongPress }) => (
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          accessibilityRole="button"
          accessibilityLabel={`${title}, ${deck.due} due, ${deck.new} new`}
          style={({ pressed }) => [
            styles.deckRow,
            !first && styles.deckRowLine,
            pressed && styles.rowPressed,
          ]}
        >
          <Text style={styles.deckTitle} numberOfLines={1}>
            {title}
          </Text>
          {deck.due > 0 ? (
            <View style={styles.dueTag}>
              <View style={styles.dueDot} />
              <Text style={styles.dueText}>{deck.due} due</Text>
            </View>
          ) : null}
          {relative ? <Text style={styles.deckMeta}>{relative}</Text> : null}
        </Pressable>
      )}
    </NativeContextMenu>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    loading: { paddingVertical: 48, alignItems: "center" },
    content: { gap: 24 },
    errorCard: {
      alignItems: "center",
    },
    errorTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 10,
    },
    errorBody: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 4,
    },
    greetingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    greeting: {
      ...serifFont(),
      flex: 1,
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.45,
      color: colors.fgPrimary,
    },
    sectionHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      gap: 12,
      marginBottom: 6,
    },
    sectionTitle: {
      flexShrink: 1,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    sectionAction: {
      fontSize: 15,
      lineHeight: 20,
      color: colors.accentInk,
    },
    deckRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingVertical: 12,
    },
    deckRowLine: {
      borderTopColor: colors.line,
      borderTopWidth: 1,
    },
    rowPressed: { opacity: 0.6 },
    deckTitle: {
      flex: 1,
      minWidth: 0,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    dueTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    dueDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.dueDot,
    },
    dueText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgPrimary,
    },
    deckMeta: {
      minWidth: 48,
      textAlign: "right",
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
  });
}

function createTodayStyles(colors: ThemeColors) {
  return StyleSheet.create({
    title: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    sub: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      marginTop: 4,
    },
    split: {
      marginTop: 16,
    },
    bar: {
      flexDirection: "row",
      gap: 2,
      height: 5,
      borderRadius: 3,
      overflow: "hidden",
      backgroundColor: colors.bgHover,
    },
    legend: {
      flexDirection: "row",
      gap: 14,
      marginTop: 8,
    },
    legendItem: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
    },
    legendValue: {
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    primary: {
      marginTop: 16,
    },
    startsWith: {
      marginTop: 8,
      textAlign: "center",
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
    },
    footer: {
      marginTop: 14,
      paddingTop: 12,
      borderTopColor: colors.line,
      borderTopWidth: 1,
      gap: 10,
    },
    links: {
      flexDirection: "row",
      alignItems: "center",
      gap: 20,
    },
    link: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    linkText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgSecondary,
    },
    summaryRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    summary: {
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
  });
}
