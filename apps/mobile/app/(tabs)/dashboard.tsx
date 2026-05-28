import { router, useNavigation } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Circle, G } from "react-native-svg";
import { DashboardHeader } from "@/components/dashboard/dashboard-header";
import { Avatar } from "@/components/ui/avatar";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeckSelect, DeckSelectModal } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ReviewHeatmap } from "@/components/review-heatmap";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DashboardStats } from "@deephaus/api-client";

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
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDeckId, setSelectedDeckId] = useState<string | null>(null);
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const scrollY = useRef(new Animated.Value(0)).current;

  const load = useCallback(async () => {
    if (!session) return;

    try {
      setLoadError(null);
      const dashboard = await api.getDashboardStats();
      setStats(dashboard);
      setSelectedDeckId((current) => current ?? dashboard.per_deck[0]?.deck_id ?? null);

      try {
        const heatmapData = await api.getReviewHeatmap(year);
        setHeatmap(heatmapData.counts);
      } catch {
        setHeatmap({});
      }
    } catch (err) {
      setLoadError(formatLoadError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
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
        label: `${d.name} (${d.due} due · ${d.new} new)`,
      })),
    [stats],
  );

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2].map((y) => ({ id: String(y), label: String(y) }));
  }, []);

  const initials = (user?.email ?? "??").slice(0, 2).toUpperCase();

  const overviewTotals = stats
    ? {
        total: stats.state_breakdown.new + stats.state_breakdown.learning + stats.state_breakdown.review + stats.state_breakdown.relearning,
        new: stats.state_breakdown.new,
        review: stats.state_breakdown.review,
        learning: stats.state_breakdown.learning + stats.state_breakdown.relearning,
      }
    : null;

  const studyDisabled = !selectedDeck || selectedDeck.due + selectedDeck.new === 0;
  const startStudy = () => {
    if (selectedDeck) router.push(`/(tabs)/study/${selectedDeck.deck_id}`);
  };

  return (
    <View style={styles.root}>
      {loading ? (
        <PageHeader
          title="Dashboard"
          right={
            <Pressable
              onPress={() => router.push("/(tabs)/profile" as never)}
              hitSlop={8}
              style={({ pressed }) => [pressed && { opacity: 0.7 }]}
            >
              <Avatar initials={initials} size="md" />
            </Pressable>
          }
        />
      ) : (
        <DashboardHeader
          scrollY={scrollY}
          initials={initials}
          selectedDeck={selectedDeck}
          deckDisabled={deckOptions.length === 0}
          studyDisabled={studyDisabled}
          onProfilePress={() => router.push("/(tabs)/profile" as never)}
          onDeckPress={() => deckOptions.length > 0 && setDeckPickerOpen(true)}
          onStudyPress={startStudy}
        />
      )}

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <Animated.ScrollView
          contentContainerStyle={styles.content}
          scrollEventThrottle={16}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { y: scrollY } } }],
            { useNativeDriver: false },
          )}
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
                pill
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
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Overview</Text>
                <Card padding={16} style={{ marginBottom: 8 }}>
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
                      <Text style={styles.todayHighlight}>{stats.reviewed_today} reviewed today</Text>
                      <Text> · {stats.due_now} waiting</Text>
                    </Text>
                  </View>
                </Card>
              </View>

              <View style={styles.section}>
                <Card padding={16}>
                  <View style={styles.heatHeaderRow}>
                    <Text style={styles.muted}>
                      <Text style={styles.heatTotal}>
                        {Object.values(heatmap).reduce((s, v) => s + v, 0)} reviews
                      </Text>{" "}
                      this year
                    </Text>
                    <View style={{ minWidth: 100 }}>
                      <DeckSelect
                        small
                        value={String(year)}
                        onPress={() => setYearPickerOpen(true)}
                      />
                    </View>
                  </View>
                  <ReviewHeatmap year={year} counts={heatmap} />
                </Card>
              </View>

              <View style={styles.section}>
                <View style={styles.decksHeader}>
                  <Text style={styles.sectionTitle}>
                    Decks ({stats.per_deck.length})
                  </Text>
                  {stats.per_deck.length > 6 && (
                    <Pressable onPress={() => router.push("/(tabs)/browse")} hitSlop={6}>
                      <View style={styles.viewAll}>
                        <Text style={styles.viewAllText}>View all</Text>
                        <Icon name="arrowRightSmall" size={14} color={colors.brand600} />
                      </View>
                    </Pressable>
                  )}
                </View>
                <View style={styles.deckList}>
                  {stats.per_deck.slice(0, 6).map((deck) => (
                    <DeckCard
                      key={deck.deck_id}
                      title={deck.name}
                      cards={deck.total}
                      due={deck.due}
                      newCount={deck.new}
                      onOpen={() => router.push("/(tabs)/browse")}
                      onStudy={() => router.push(`/(tabs)/study/${deck.deck_id}`)}
                    />
                  ))}
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
                        pill
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
        </Animated.ScrollView>
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
  onOpen,
  onStudy,
}: {
  title: string;
  cards: number;
  due: number;
  newCount: number;
  onOpen: () => void;
  onStudy: () => void;
}) {
  const { colors } = useTheme();
  const deckStyles = useMemo(() => createDeckStyles(colors), [colors]);
  return (
    <Card padding={14}>
      <View style={deckStyles.titleRow}>
        <Icon name="book" size={18} color={colors.fgSecondary} />
        <Text style={deckStyles.title}>{title}</Text>
      </View>
      <View style={deckStyles.badges}>
        <BadgePill icon="layers" label={`${cards} cards`} tone="brand" />
        <BadgePill icon="clock" label={`${due} due`} tone="orange" />
        <BadgePill icon="sparklesOutline" label={`${newCount} new`} tone="brand" />
      </View>
      <ProgressBar
        value={cards === 0 ? 0 : Math.min(1, (cards - due) / Math.max(1, cards))}
        height={4}
        style={{ marginTop: 12, marginBottom: 12 }}
      />
      <View style={deckStyles.actions}>
        <Button variant="secondary" size="md" pill label="Open" onPress={onOpen} style={{ flex: 1 }} />
        <Button variant="brand" size="md" pill label="Study" onPress={onStudy} style={{ flex: 1 }} />
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
    heatTotal: { color: colors.fgPrimary, fontWeight: "600" },
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
      fontSize: 9,
      fontWeight: "500",
      color: colors.fgQuaternary,
      letterSpacing: 1,
      textTransform: "uppercase",
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
      fontSize: 11,
      fontWeight: "500",
      color: colors.fgQuaternary,
      letterSpacing: 0.6,
      textTransform: "uppercase",
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
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    actions: {
      flexDirection: "row",
      gap: 8,
    },
  });
}
