import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { LeaderboardPanel } from "@/components/dashboard/leaderboard-panel";
import { GlobalSearchResults } from "@/components/global-search-results";
import {
  DeckActionsSheet,
  type DeckActionsDeck,
} from "@/components/deck-actions-sheet";
import { SyncStatusPill } from "@/components/sync-status-pill";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  DeckSelect,
  DeckSelectLabel,
  DeckSelectModal,
} from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { DeckLogo, ownedDeckLogoKind, type DeckLogoKind } from "@/components/ui/deck-logo";
import { Icon } from "@/components/ui/icon";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ReviewHeatmap } from "@/components/review-heatmap";
import { useAuth } from "@/lib/auth-context";
import { deckDisplayName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DashboardStats } from "@deephaus/api-client";

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

function formatToday(): string {
  return new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
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
  return d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
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
    return "Server error loading dashboard. Try again shortly.";
  }
  if (status != null) {
    return "Could not load dashboard stats.";
  }
  return "Could not reach the API. Make sure the web server is running.";
}

export default function DashboardScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation();
  const { user, session } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [heatmapForecast, setHeatmapForecast] = useState<Record<string, number>>({});
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [actionsDeck, setActionsDeck] = useState<DeckActionsDeck | null>(null);
  const loadInFlight = useRef(false);

  const openStats = useCallback((deckId: string | null) => {
    router.push({
      pathname: "/(tabs)/dashboard/stats",
      params: deckId ? { deckId } : {},
    });
  }, []);

  const load = useCallback(async () => {
    if (!session) return;
    // Mount and the initial navigation focus event both trigger a load;
    // collapse overlapping requests into one.
    if (loadInFlight.current) return;
    loadInFlight.current = true;

    setLoadError(null);
    // The heatmap fills in when ready; the screen renders as soon as the
    // headline stats arrive instead of waiting on both requests in sequence.
    const heatmapPromise = offlineData
      .getReviewHeatmap(year)
      .then((heatmapData) => {
        setHeatmap(heatmapData.counts);
        setHeatmapForecast(heatmapData.forecast ?? {});
      })
      .catch(() => {
        setHeatmap({});
        setHeatmapForecast({});
      });

    try {
      const dashboard = await offlineData.getDashboardStats();
      setStats(dashboard);
      setSelectedDeckId((current) => current ?? dashboard.per_deck[0]?.deck_id ?? null);
    } catch (err) {
      setLoadError(formatLoadError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }

    await heatmapPromise;
    loadInFlight.current = false;
  }, [year, session]);

  useEffect(() => {
    if (!session) {
      setLoading(false);
      return;
    }

    void load();
    const unsub = navigation.addListener("focus", () => {
      void load();
    });
    return unsub;
  }, [navigation, load, session]);

  const selectedDeck = useMemo(
    () => stats?.per_deck.find((d) => d.deck_id === selectedDeckId) ?? stats?.per_deck[0],
    [stats, selectedDeckId],
  );

  const deckOptions = useMemo(
    () =>
      (stats?.per_deck ?? []).map((d) => ({
        id: d.deck_id,
        label: `${deckDisplayName(d.name)} (${d.due} due · ${d.new} new)`,
      })),
    [stats],
  );

  const [showAllDecks, setShowAllDecks] = useState(false);

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2].map((y) => ({ id: String(y), label: String(y) }));
  }, []);

  const profileName =
    (user?.user_metadata?.full_name as string | undefined)?.trim() ||
    (user?.user_metadata?.name as string | undefined)?.trim() ||
    user?.email?.split("@")[0] ||
    "DeepHaus";
  const profileNameParts = profileName.split(/\s+/).filter(Boolean);

  const overviewTotals = stats
    ? {
        // Match the web dashboard: total_cards is the authoritative deck-wide
        // count (includes suspended), while the state breakdown intentionally
        // excludes suspended cards.
        total: stats.total_cards,
        new: stats.state_breakdown.new,
        review: stats.state_breakdown.review,
        learning: stats.state_breakdown.learning + stats.state_breakdown.relearning,
      }
    : null;

  const firstName = profileNameParts[0] ?? "";
  const greeting = firstName ? `Welcome back, ${firstName}!` : "Welcome back!";
  const greetingSubtitle = stats
    ? `${formatToday()} · ${stats.total_cards.toLocaleString()} cards across ${stats.per_deck.length.toLocaleString()} deck${stats.per_deck.length === 1 ? "" : "s"}`
    : formatToday();
  const cardsReady = stats ? stats.due_now + stats.new_today_remaining : 0;

  const studyDisabled = !selectedDeck || selectedDeck.due + selectedDeck.new === 0;
  const startStudy = () => {
    if (!selectedDeck) return;
    // Replacing with the target study route resets the selected tab without
    // dispatching POP_TO_TOP from this non-stack dashboard screen.
    router.replace(`/(tabs)/study/${selectedDeck.deck_id}`);
  };
  const openCram = () => {
    router.push("/(tabs)/study/cram");
  };

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Dashboard"
        search={{
          placeholder: "Search decks, cards, community…",
          onChangeText: setSearchQuery,
          onCancel: () => setSearchQuery(""),
        }}
        actions={[
          {
            icon: "user",
            sfIcon: "person.crop.circle",
            label: "Profile",
            placement: "left",
            onPress: () => router.push("/profile"),
          },
          ...(Platform.OS !== "ios"
            ? [
                {
                  icon: "search" as const,
                  sfIcon: "magnifyingglass" as const,
                  label: "Search",
                  onPress: () => router.push("/search"),
                },
              ]
            : []),
        ]}
      />

      {searchQuery.trim().length > 0 ? (
        <GlobalSearchResults query={searchQuery} />
      ) : loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.brand500}
            />
          }
        >
          {loadError && !stats && (
            <Card padding={16} style={styles.errorCard}>
              <FeaturedIcon icon="warning" variant="orange" size="md" />
              <Text style={styles.errorTitle}>Dashboard unavailable</Text>
              <Text style={styles.errorBody}>{loadError}</Text>
              <Button
                variant="secondary"
                size="md"
                label="Try again"
                onPress={() => {
                  setLoading(true);
                  void load();
                }}
                style={{ marginTop: 12 }}
              />
            </Card>
          )}

          {stats && overviewTotals && (
            <>
              <View style={styles.greetingRow}>
                <View style={styles.greetingBlock}>
                  <Text style={styles.greetingTitle}>{greeting}</Text>
                  <Text style={styles.greetingSub}>{greetingSubtitle}</Text>
                </View>
                <SyncStatusPill />
              </View>

              <Card padding={16}>
                <DeckSelectLabel>Deck</DeckSelectLabel>
                <DeckSelect
                  value={
                    selectedDeck
                      ? `${deckDisplayName(selectedDeck.name)} (${selectedDeck.due} due · ${selectedDeck.new} new)`
                      : "No decks yet"
                  }
                  onPress={() => deckOptions.length > 0 && setDeckPickerOpen(true)}
                  disabled={deckOptions.length === 0}
                />
                <View style={styles.ctaRow}>
                  <Button
                    variant="primary"
                    size="lg"
                    label="Study Now"
                    trailingIcon="arrowRight"
                    disabled={studyDisabled}
                    onPress={startStudy}
                    style={{ flex: 1 }}
                  />
                  <Button
                    variant="brand"
                    size="lg"
                    label="Cram"
                    leadingIcon="bolt"
                    onPress={openCram}
                    style={{ flex: 1 }}
                  />
                </View>
              </Card>

              <View style={styles.section}>
                <View style={styles.decksHeader}>
                  <Text style={styles.sectionTitle}>Overview</Text>
                  <Pressable onPress={() => openStats(null)} hitSlop={6}>
                    <View style={styles.viewAll}>
                      <Icon name="lineChart" size={14} color={colors.brand600} />
                      <Text style={styles.viewAllText}>Stats</Text>
                    </View>
                  </Pressable>
                </View>
                <Pressable
                  onPress={() => openStats(null)}
                  style={({ pressed }) => [{ marginBottom: 8 }, pressed && { opacity: 0.85 }]}
                >
                <Card padding={16}>
                  <View style={styles.donutRow}>
                    <DonutChart
                      total={overviewTotals.total}
                      values={[
                        { value: overviewTotals.new, color: colors.brand600 },
                        { value: overviewTotals.review, color: colors.brand700 },
                        { value: overviewTotals.learning, color: colors.orange400 },
                      ]}
                    />
                    <View style={styles.donutLegend}>
                      <LegendRow
                        color={colors.brand600}
                        label="New"
                        value={overviewTotals.new}
                      />
                      <LegendRow
                        color={colors.brand700}
                        label="Review"
                        value={overviewTotals.review}
                      />
                      <LegendRow
                        color={colors.orange400}
                        label="Learning"
                        value={overviewTotals.learning}
                      />
                    </View>
                  </View>

                  <View style={styles.divider} />

                  <View style={styles.statRow}>
                    <StatTile
                      icon="fire"
                      iconVariant="orange"
                      value={`${stats.streak} day${stats.streak === 1 ? "" : "s"}`}
                      label="Study streak"
                    />
                    <StatTile
                      icon="pieChart"
                      iconVariant="brand"
                      value={
                        stats.retention_pct != null
                          ? `${Math.round(stats.retention_pct * 100)}%`
                          : "—"
                      }
                      label="30d retention"
                    />
                  </View>

                  <View style={styles.todayBox}>
                    <Text style={styles.todayLine}>
                      {cardsReady > 0 ? (
                        <>
                          <Text style={styles.todayHighlight}>
                            {cardsReady.toLocaleString()} ready for today
                          </Text>
                          <Text> · About {estimateDuration(cardsReady)}</Text>
                        </>
                      ) : (
                        <Text style={styles.todayHighlight}>You're all caught up</Text>
                      )}
                    </Text>
                    <Text style={styles.todaySubLine}>
                      {stats.reviewed_today} reviewed today · {stats.due_now} due now
                    </Text>
                  </View>
                </Card>
                </Pressable>
              </View>

              <View style={styles.section}>
                <Card padding={16}>
                  <View style={styles.heatHeaderRow}>
                    <Text style={styles.heatTotal}>Activity</Text>
                    <View style={{ minWidth: 100 }}>
                      <DeckSelect
                        small
                        value={String(year)}
                        onPress={() => setYearPickerOpen(true)}
                      />
                    </View>
                  </View>
                  <ReviewHeatmap
                    year={year}
                    counts={heatmap}
                    forecast={heatmapForecast}
                  />
                </Card>
              </View>

              <View style={styles.section}>
                <LeaderboardPanel />
              </View>

              <View style={styles.section}>
                <View style={styles.decksHeader}>
                  <Text style={styles.sectionTitle}>
                    Decks ({stats.per_deck.length})
                  </Text>
                  {stats.per_deck.length > 6 && (
                    <Pressable onPress={() => router.push("/(tabs)/study")} hitSlop={6}>
                      <View style={styles.viewAll}>
                        <Text style={styles.viewAllText}>View all</Text>
                        <Icon name="arrowRightSmall" size={14} color={colors.brand600} />
                      </View>
                    </Pressable>
                  )}
                </View>
                <View style={styles.deckList}>
                  {(showAllDecks ? stats.per_deck : stats.per_deck.slice(0, 6)).map((deck) => (
                    <DeckCard
                      key={deck.deck_id}
                      title={deckDisplayName(deck.name)}
                      cards={deck.total}
                      due={deck.due}
                      newCount={deck.new}
                      lastReviewed={formatRelative(deck.last_reviewed)}
                      logoKind={ownedDeckLogoKind(deck)}
                      onOpen={() =>
                        router.push({
                          pathname: "/(tabs)/browse",
                          params: { deck: deck.deck_id },
                        })
                      }
                      onStudy={() => {
                        router.replace(`/(tabs)/study/${deck.deck_id}`);
                      }}
                      onMore={() =>
                        setActionsDeck({
                          id: deck.deck_id,
                          title: deckDisplayName(deck.name),
                          cardCount: deck.total,
                        })
                      }
                    />
                  ))}
                  {stats.per_deck.length > 6 && (
                    <Button
                      variant="secondary"
                      size="md"
                      label={
                        showAllDecks
                          ? "Show fewer decks"
                          : `Show all ${stats.per_deck.length} decks`
                      }
                      onPress={() => setShowAllDecks((v) => !v)}
                      fullWidth
                    />
                  )}
                  {stats.per_deck.length === 0 && (
                    <Card padding={20} style={{ alignItems: "center" }}>
                      <FeaturedIcon icon="sparkles" variant="brand" size="lg" />
                      <Text style={styles.emptyTitle}>No decks yet</Text>
                      <Text style={styles.emptyBody}>
                        Head to Create to generate your first set of cards.
                      </Text>
                      <Button
                        variant="brand"
                        size="md"
                        label="Create a deck"
                        onPress={() => router.push("/(tabs)/create")}
                        style={{ marginTop: 12 }}
                      />
                    </Card>
                  )}
                </View>
              </View>
            </>
          )}
        </ScrollView>
      )}

      <DeckSelectModal
        visible={deckPickerOpen}
        onClose={() => setDeckPickerOpen(false)}
        title="Select deck"
        options={deckOptions}
        selectedId={selectedDeckId ?? undefined}
        onSelect={(opt) => setSelectedDeckId(opt.id)}
      />
      <DeckSelectModal
        visible={yearPickerOpen}
        onClose={() => setYearPickerOpen(false)}
        title="Year"
        options={yearOptions}
        selectedId={String(year)}
        onSelect={(opt) => setYear(parseInt(opt.id, 10))}
      />
      <DeckActionsSheet
        visible={actionsDeck != null}
        deck={actionsDeck}
        onClose={() => setActionsDeck(null)}
        onRenamed={(name) => {
          if (!actionsDeck) return;
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  per_deck: prev.per_deck.map((d) =>
                    d.deck_id === actionsDeck.id ? { ...d, name } : d,
                  ),
                }
              : prev,
          );
          setActionsDeck((prev) => (prev ? { ...prev, title: name } : prev));
        }}
        onDuplicated={() => {
          void load();
        }}
        onDeleted={(deckId) => {
          setStats((prev) =>
            prev
              ? {
                  ...prev,
                  per_deck: prev.per_deck.filter((d) => d.deck_id !== deckId),
                }
              : prev,
          );
          setSelectedDeckId((current) => (current === deckId ? null : current));
          setActionsDeck(null);
        }}
      />
    </View>
  );
}

function DonutChart({
  total,
  values,
}: {
  total: number;
  values: { value: number; color: string }[];
}) {
  const { colors } = useTheme();
  const donutStyles = useMemo(() => createDonutStyles(colors), [colors]);
  const size = 96;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const C = 2 * Math.PI * r;
  let offset = 0;
  return (
    <View style={{ width: size, height: size, position: "relative" }}>
      <Svg width={size} height={size}>
        <G rotation={-90} originX={size / 2} originY={size / 2}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={colors.gray100}
            strokeWidth={stroke}
            fill="transparent"
          />
          {values.map((v, i) => {
            if (!total || v.value <= 0) return null;
            const seg = (v.value / total) * C;
            const node = (
              <Circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                stroke={v.color}
                strokeWidth={stroke}
                fill="transparent"
                strokeDasharray={`${seg} ${C}`}
                strokeDashoffset={-offset}
                strokeLinecap="butt"
              />
            );
            offset += seg;
            return node;
          })}
        </G>
      </Svg>
      <View style={donutStyles.label}>
        <Text style={donutStyles.value}>{total}</Text>
        <Text style={donutStyles.unit}>cards</Text>
      </View>
    </View>
  );
}

function LegendRow({ color, label, value }: { color: string; label: string; value: number }) {
  const { colors } = useTheme();
  const legendStyles = useMemo(() => createLegendStyles(colors), [colors]);
  return (
    <View style={legendStyles.row}>
      <View style={legendStyles.left}>
        <View style={[legendStyles.dot, { backgroundColor: color }]} />
        <Text style={legendStyles.label}>{label}</Text>
      </View>
      <Text style={legendStyles.value}>{value}</Text>
    </View>
  );
}

function StatTile({
  icon,
  iconVariant,
  value,
  label,
}: {
  icon: "fire" | "pieChart";
  iconVariant: "orange" | "brand";
  value: string;
  label: string;
}) {
  const { colors } = useTheme();
  const statTileStyles = useMemo(() => createStatTileStyles(colors), [colors]);
  return (
    <View style={statTileStyles.row}>
      <FeaturedIcon icon={icon} variant={iconVariant} size="sm" />
      <View style={{ flex: 1 }}>
        <Text style={statTileStyles.value}>{value}</Text>
        <Text style={statTileStyles.label}>{label}</Text>
      </View>
    </View>
  );
}

function DeckCard({
  title,
  cards,
  due,
  newCount,
  lastReviewed,
  logoKind,
  onOpen,
  onStudy,
  onMore,
}: {
  title: string;
  cards: number;
  due: number;
  newCount: number;
  lastReviewed: string | null;
  logoKind: DeckLogoKind;
  onOpen: () => void;
  onStudy: () => void;
  onMore: () => void;
}) {
  const { colors } = useTheme();
  const deckStyles = useMemo(() => createDeckStyles(colors), [colors]);
  const progress = cards === 0 ? 0 : Math.min(1, (cards - due) / Math.max(1, cards));
  return (
    <Card padding={14}>
      <View style={deckStyles.titleRow}>
        <DeckLogo kind={logoKind} />
        <Text style={deckStyles.title}>{title}</Text>
        <Pressable
          onPress={onMore}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Actions for ${title}`}
          style={deckStyles.moreBtn}
        >
          <Icon name="more" size={18} color={colors.fgQuaternary} />
        </Pressable>
      </View>
      <View style={deckStyles.badges}>
        <BadgePill icon="layers" label={`${cards} cards`} tone="gray" />
        <BadgePill icon="clock" label={`${due} due`} tone="orange" />
        <BadgePill icon="sparklesOutline" label={`${newCount} new`} tone="brand" />
      </View>
      <ProgressBar value={progress} height={4} style={{ marginTop: 12, marginBottom: 6 }} />
      <View style={deckStyles.metaRow}>
        <Text style={deckStyles.metaText}>{Math.round(progress * 100)}% caught up</Text>
        <Text style={deckStyles.metaText}>
          {lastReviewed ? `Last reviewed ${lastReviewed}` : "Not reviewed yet"}
        </Text>
      </View>
      <View style={deckStyles.actions}>
        <Button variant="secondary" size="md" label="Open" onPress={onOpen} style={{ flex: 1 }} />
        <Button variant="brand" size="md" label="Study" onPress={onStudy} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: 40,
      gap: 12,
    },
    errorCard: {
      alignItems: "center",
      marginBottom: 4,
    },
    errorTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 10,
    },
    errorBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 4,
    },
    section: {
      gap: 8,
    },
    sectionTitle: {
      fontSize: 16,
      lineHeight: 24,
      fontWeight: "600",
      color: colors.fgPrimary,
      paddingHorizontal: 4,
    },
    donutRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
    },
    donutLegend: {
      flex: 1,
      gap: 6,
    },
    divider: {
      height: 1,
      backgroundColor: colors.borderSecondary,
      marginVertical: 16,
      marginHorizontal: -16,
    },
    statRow: {
      flexDirection: "row",
      gap: 16,
      paddingHorizontal: 4,
    },
    todayBox: {
      marginTop: 14,
      paddingVertical: 10,
      paddingHorizontal: 12,
      backgroundColor: colors.gray50,
      borderRadius: 8,
      alignItems: "center",
    },
    todayLine: {
      fontSize: 13,
      color: colors.fgSecondary,
    },
    todaySubLine: {
      fontSize: 12,
      color: colors.fgQuaternary,
      marginTop: 3,
    },
    ctaRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 10,
    },
    greetingRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      marginBottom: 2,
    },
    greetingBlock: {
      flex: 1,
      minWidth: 0,
      paddingHorizontal: 4,
      gap: 2,
    },
    greetingTitle: {
      fontSize: 22,
      lineHeight: 28,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.3,
    },
    greetingSub: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    todayHighlight: {
      color: colors.brand700,
      fontWeight: "600",
    },
    heatHeaderRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    muted: { color: colors.fgTertiary, fontSize: 13 },
    heatTotal: { color: colors.fgPrimary, fontWeight: "600", fontSize: 15 },
    decksHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 4,
    },
    viewAll: { flexDirection: "row", alignItems: "center", gap: 2 },
    viewAllText: {
      color: colors.brand600,
      fontWeight: "600",
      fontSize: 14,
    },
    deckList: { gap: 8 },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
      marginTop: 4,
    },
  });
}

function createDonutStyles(colors: ThemeColors) {
  return StyleSheet.create({
    label: {
      position: "absolute",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: "center",
      justifyContent: "center",
    },
    value: {
      fontSize: 22,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    unit: {
      fontSize: 10,
      fontWeight: "500",
      color: colors.fgQuaternary,
      letterSpacing: 0,
      marginTop: 3,
    },
  });
}

function createLegendStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    left: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 999,
    },
    label: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    value: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
  });
}

function createStatTileStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    value: {
      fontSize: 18,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    label: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgQuaternary,
      letterSpacing: 0,
    },
  });
}

function createDeckStyles(colors: ThemeColors) {
  return StyleSheet.create({
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginBottom: 10,
    },
    title: {
      flex: 1,
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.1,
    },
    moreBtn: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      marginRight: -4,
    },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    metaRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 12,
    },
    metaText: {
      fontSize: 11,
      fontWeight: "500",
      color: colors.fgQuaternary,
    },
    actions: {
      flexDirection: "row",
      gap: 8,
    },
  });
}
