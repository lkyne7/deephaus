import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { ApiError, type AdvancedStats, type AdvancedStatsDayCount } from "@deephaus/api-client";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterPills } from "@/components/ui/filter-pills";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type AdvancedStatsDeckOption = { id: string; title: string };

type Props = {
  deckOptions: AdvancedStatsDeckOption[];
  initialDeckId?: string | null;
  /** Rendered after the headline figures; shown even when they can't load. */
  activity?: ReactNode;
  /** Rendered at the end of the scroll view. */
  children?: ReactNode;
  /** Bump to reload the stats (focus, pull to refresh). */
  refreshKey?: number;
  refreshing?: boolean;
  onRefresh?: () => void;
};

const ALL = "all";

function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pct(value: number | null): string {
  return value !== null ? `${Math.round(value * 100)}%` : "None yet";
}

function formatStability(days: number | null): string {
  if (days === null) return "None yet";
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${(days / 30).toFixed(1)}mo`;
  if (days >= 1) return `${days.toFixed(0)}d`;
  return `${(days * 24).toFixed(0)}h`;
}

function monthDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function dayOfMonth(iso: string): string {
  return String(new Date(`${iso}T00:00:00`).getDate());
}

export function AdvancedStatsContent({
  deckOptions,
  initialDeckId = null,
  activity,
  children,
  refreshKey = 0,
  refreshing = false,
  onRefresh,
}: Props) {
  const { colors } = useTheme();
  const router = useRouter();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [scope, setScope] = useState<string>(initialDeckId ?? ALL);
  const [stats, setStats] = useState<AdvancedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  useEffect(() => {
    setScope(initialDeckId ?? ALL);
  }, [initialDeckId]);

  const scopeChips = useMemo(
    () => [{ value: ALL, label: "All decks" }, ...deckOptions.map((d) => ({ value: d.id, label: d.title }))],
    [deckOptions],
  );

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    setUpgradeRequired(false);
    try {
      const deckId = target === ALL ? null : target;
      const data = await api.getAdvancedStats(deckId);
      setStats(data);
    } catch (err) {
      const isUpgrade =
        err instanceof ApiError && err.code === "PLAN_UPGRADE_REQUIRED";
      setUpgradeRequired(isUpgrade);
      setError(
        err instanceof ApiError
          ? err.message
          : // Network failures carry native details nobody needs to read.
            "Couldn't load your stats. Check your connection and try again.",
      );
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  // refreshKey changes when Insights regains focus or is pulled down.
  useEffect(() => {
    void load(scope);
  }, [scope, load, refreshKey]);

  return (
    <ScrollView
      style={styles.route}
      contentContainerStyle={styles.bodyContent}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} /> : undefined
      }
    >
      <FilterPills
        accessibilityLabel="Filter stats by deck"
        options={scopeChips}
        value={scope}
        onChange={setScope}
        style={styles.pills}
      />

      {error && !stats ? (
        <View style={styles.centered}>
          <FeaturedIcon
            icon={upgradeRequired ? "sparkles" : "warning"}
            variant={upgradeRequired ? "brand" : "gray"}
            size="md"
          />
          <Text style={styles.errorText}>{error}</Text>
          {upgradeRequired ? (
            <Button
              variant="primary"
              size="md"
              label="View plans"
              onPress={() => router.push("/profile")}
            />
          ) : (
            <Button
              variant="secondary"
              size="md"
              label="Try again"
              onPress={() => void load(scope)}
            />
          )}
        </View>
      ) : !stats ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <>
          {loading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator color={colors.accent} size="small" />
            </View>
          ) : null}
          <StatsContent stats={stats} colors={colors} styles={styles} activity={activity} />
        </>
      )}
      {/* Activity isn't plan-gated, so it stays when advanced stats can't load. */}
      {stats ? null : activity}
      {children}
    </ScrollView>
  );
}

function StatsContent({
  stats,
  colors,
  styles,
  activity,
}: {
  stats: AdvancedStats;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  activity?: ReactNode;
}) {
  const ratingTotal =
    stats.rating_distribution.again +
    stats.rating_distribution.hard +
    stats.rating_distribution.good +
    stats.rating_distribution.easy;

  const maturityTotal =
    stats.maturity.new + stats.maturity.learning + stats.maturity.young + stats.maturity.mature;
  const maturePct = maturityTotal > 0 ? stats.maturity.mature / maturityTotal : null;

  const tiles: Array<{ label: string; value: string }> = [
    { label: "Total cards", value: fmt(stats.total_cards) },
    { label: "Total reviews", value: fmt(stats.total_reviews) },
    { label: `${stats.retention_window_days}-day retention`, value: pct(stats.retention_30d) },
    { label: "Study streak", value: `${stats.streak} day${stats.streak === 1 ? "" : "s"}` },
    { label: "Mature", value: pct(maturePct) },
    { label: "Avg interval", value: formatStability(stats.avg_stability) },
    { label: "Avg difficulty", value: stats.avg_difficulty !== null ? `${stats.avg_difficulty.toFixed(1)}/10` : "None yet" },
    { label: `Reviews (${stats.retention_window_days}d)`, value: fmt(stats.reviews_30d) },
  ];

  return (
    <>
      <View style={styles.tileGrid}>
        {tiles.map((t, index) => (
          <View
            key={t.label}
            style={[
              styles.tile,
              index % 2 === 0 && styles.tileLeft,
              index < tiles.length - 2 && styles.tileUpper,
            ]}
          >
            <Text style={styles.tileValue}>{t.value}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      {activity}

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Answer buttons</Text>
        <Text style={styles.blockHint}>
          Last {stats.rating_window_days} days · {fmt(ratingTotal)} reviews
        </Text>
        <View style={styles.barList}>
          <DistributionBar label="Again" value={stats.rating_distribution.again} total={ratingTotal} color={colors.gradeAgain} styles={styles} />
          <DistributionBar label="Hard" value={stats.rating_distribution.hard} total={ratingTotal} color={colors.gradeHard} styles={styles} />
          <DistributionBar label="Good" value={stats.rating_distribution.good} total={ratingTotal} color={colors.gradeGood} styles={styles} />
          <DistributionBar label="Easy" value={stats.rating_distribution.easy} total={ratingTotal} color={colors.gradeEasy} styles={styles} />
        </View>
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Card maturity</Text>
        <Text style={styles.blockHint}>{fmt(maturityTotal)} active cards</Text>
        <View style={styles.barList}>
          <DistributionBar label="New" value={stats.maturity.new} total={maturityTotal} color={colors.heat[1]} styles={styles} />
          <DistributionBar label="Learning" value={stats.maturity.learning} total={maturityTotal} color={colors.heat[2]} styles={styles} />
          <DistributionBar label="Young" value={stats.maturity.young} total={maturityTotal} color={colors.heat[3]} styles={styles} />
          <DistributionBar label="Mature" value={stats.maturity.mature} total={maturityTotal} color={colors.heat[4]} styles={styles} />
        </View>
        {stats.maturity.suspended > 0 ? (
          <Text style={styles.blockHint}>{fmt(stats.maturity.suspended)} suspended (excluded)</Text>
        ) : null}
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Reviews per day</Text>
        <Text style={styles.blockHint}>Last {stats.reviews_per_day.length} days</Text>
        <MiniBars data={stats.reviews_per_day} color={colors.accent} mode="history" colors={colors} styles={styles} />
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Upcoming reviews</Text>
        <Text style={styles.blockHint}>Becoming due over the next {stats.due_forecast.length} days</Text>
        <MiniBars data={stats.due_forecast} color={colors.accent} mode="forecast" colors={colors} styles={styles} />
      </View>
    </>
  );
}

function DistributionBar({
  label,
  value,
  total,
  color,
  styles,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const ratio = total > 0 ? value / total : 0;
  const widthPct = total > 0 ? Math.max(ratio * 100, value > 0 ? 2 : 0) : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${widthPct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.barValue}>
        {fmt(value)}
        {total > 0 ? <Text style={styles.barPct}>{`  ${Math.round(ratio * 100)}%`}</Text> : null}
      </Text>
    </View>
  );
}

const CHART_HEIGHT = 96;

function MiniBars({
  data,
  color,
  mode,
  colors,
  styles,
}: {
  data: AdvancedStatsDayCount[];
  color: string;
  mode: "history" | "forecast";
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);
  const total = data.reduce((sum, d) => sum + d.count, 0);

  if (total === 0) {
    return (
      <View style={styles.chartEmpty}>
        <Text style={styles.chartEmptyText}>
          {mode === "forecast" ? "Nothing scheduled" : "No reviews logged yet"}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ marginTop: 8 }}>
      <View style={styles.chart}>
        {data.map((d, i) => {
          const h = max > 0 ? Math.max((d.count / max) * CHART_HEIGHT, d.count > 0 ? 3 : 0) : 0;
          return (
            <View key={d.date} style={styles.chartCol}>
              <View style={[styles.chartBar, { height: h, backgroundColor: color }]} />
              {mode === "forecast" ? (
                <Text style={styles.chartTick} numberOfLines={1}>
                  {i === 0 ? "Now" : i % 2 === 0 ? dayOfMonth(d.date) : ""}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
      {mode === "history" && data.length > 0 ? (
        <View style={styles.chartCaption}>
          <Text style={styles.chartCaptionText}>{monthDay(data[0].date)}</Text>
          <Text style={styles.chartCaptionText}>Today</Text>
        </View>
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    route: {
      flex: 1,
      backgroundColor: colors.bgCanvas,
    },
    pills: { marginHorizontal: -20 },
    centered: {
      paddingVertical: 40,
      alignItems: "center",
      gap: 12,
    },
    errorText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    bodyContent: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 48,
      gap: 14,
    },
    inlineLoading: {
      alignItems: "center",
      paddingBottom: 4,
    },
    tileGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.xl3,
      overflow: "hidden",
    },
    tile: {
      width: "50%",
      paddingVertical: 12,
      paddingHorizontal: 16,
    },
    tileLeft: {
      borderRightWidth: 1,
      borderRightColor: colors.line,
    },
    tileUpper: {
      borderBottomWidth: 1,
      borderBottomColor: colors.line,
    },
    tileValue: {
      fontSize: 24,
      lineHeight: 30,
      fontWeight: "600",
      letterSpacing: -0.3,
      color: colors.fgPrimary,
    },
    tileLabel: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
    },
    cardBlock: {
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.line,
      borderRadius: radius.xl3,
      padding: 16,
      gap: 4,
    },
    blockTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    blockHint: {
      fontSize: 12,
      lineHeight: 16,
      color: colors.fgTertiary,
    },
    barList: {
      gap: 8,
      marginTop: 8,
    },
    barRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    barLabel: {
      width: 58,
      fontSize: 12,
      color: colors.fgSecondary,
    },
    barTrack: {
      flex: 1,
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.bgHover,
      overflow: "hidden",
    },
    barFill: {
      height: "100%",
      borderRadius: radius.pill,
    },
    barValue: {
      width: 78,
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgSecondary,
      textAlign: "right",
    },
    barPct: {
      fontSize: 11,
      fontWeight: "400",
      color: colors.fgTertiary,
    },
    chart: {
      flexDirection: "row",
      alignItems: "flex-end",
      gap: 2,
      height: CHART_HEIGHT,
    },
    chartCol: {
      flex: 1,
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 3,
    },
    chartBar: {
      width: "78%",
      borderTopLeftRadius: 2,
      borderTopRightRadius: 2,
    },
    chartTick: {
      fontSize: 8,
      color: colors.fgTertiary,
    },
    chartCaption: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
    },
    chartCaptionText: {
      fontSize: 11,
      color: colors.fgTertiary,
    },
    chartEmpty: {
      paddingVertical: 28,
      alignItems: "center",
    },
    chartEmptyText: {
      fontSize: 13,
      color: colors.fgTertiary,
    },
  });
}
