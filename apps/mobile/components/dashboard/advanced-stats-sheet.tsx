import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon, type IconName } from "@/components/ui/icon";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { AdvancedStats, AdvancedStatsDayCount } from "@deephaus/api-client";

export type AdvancedStatsDeckOption = { id: string; title: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  deckOptions: AdvancedStatsDeckOption[];
  initialDeckId?: string | null;
};

const ALL = "all";

function fmt(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function pct(value: number | null): string {
  return value !== null ? `${Math.round(value * 100)}%` : "—";
}

function formatStability(days: number | null): string {
  if (days === null) return "—";
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

export function AdvancedStatsSheet({
  visible,
  onClose,
  deckOptions,
  initialDeckId = null,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const sheetHeight = Math.floor(windowHeight * 0.92);
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [scope, setScope] = useState<string>(initialDeckId ?? ALL);
  const [stats, setStats] = useState<AdvancedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) setScope(initialDeckId ?? ALL);
  }, [visible, initialDeckId]);

  const scopeChips = useMemo(
    () => [{ id: ALL, title: "All decks" }, ...deckOptions.map((d) => ({ id: d.id, title: d.title }))],
    [deckOptions],
  );

  const title = useMemo(() => {
    if (scope === ALL) return "Stats";
    const deck = deckOptions.find((d) => d.id === scope);
    return deck ? `Stats · ${deck.title}` : "Stats";
  }, [scope, deckOptions]);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const deckId = target === ALL ? null : target;
      const data = await api.getAdvancedStats(deckId);
      setStats(data);
    } catch {
      setError("Could not load statistics.");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    void load(scope);
  }, [visible, scope, load]);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <Pressable style={styles.scrimTap} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close stats" />
        <View style={[styles.sheet, { height: sheetHeight, paddingBottom: Math.max(insets.bottom, 16) }]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Pressable onPress={onClose} hitSlop={8} style={({ pressed }) => pressed && { opacity: 0.6 }}>
              <Icon name="close" size={22} color={colors.fgQuaternary} />
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            style={styles.chipScroll}
            contentContainerStyle={styles.chipRow}
          >
            {scopeChips.map((chip) => {
              const active = chip.id === scope;
              return (
                <Pressable
                  key={chip.id}
                  onPress={() => setScope(chip.id)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text
                    style={[styles.chipText, active && styles.chipTextActive]}
                    numberOfLines={1}
                    {...(Platform.OS === "android" ? { includeFontPadding: false } : {})}
                  >
                    {chip.title}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {error && !stats ? (
            <View style={styles.centered}>
              <FeaturedIcon icon="warning" variant="orange" size="md" />
              <Text style={styles.errorText}>{error}</Text>
              <Button variant="secondary" size="md" label="Try again" onPress={() => void load(scope)} />
            </View>
          ) : !stats ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.brand500} />
            </View>
          ) : (
            <ScrollView
              style={styles.body}
              contentContainerStyle={styles.bodyContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
            >
              {loading ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator color={colors.brand500} size="small" />
                </View>
              ) : null}
              <StatsContent stats={stats} colors={colors} styles={styles} />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function StatsContent({
  stats,
  colors,
  styles,
}: {
  stats: AdvancedStats;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
}) {
  const ratingTotal =
    stats.rating_distribution.again +
    stats.rating_distribution.hard +
    stats.rating_distribution.good +
    stats.rating_distribution.easy;

  const maturityTotal =
    stats.maturity.new + stats.maturity.learning + stats.maturity.young + stats.maturity.mature;
  const maturePct = maturityTotal > 0 ? stats.maturity.mature / maturityTotal : null;

  const tiles: Array<{ icon: IconName; label: string; value: string; accent: string }> = [
    { icon: "layers", label: "Total cards", value: fmt(stats.total_cards), accent: colors.fgSecondary },
    { icon: "refresh", label: "Total reviews", value: fmt(stats.total_reviews), accent: colors.fgSecondary },
    { icon: "pieChart", label: `${stats.retention_window_days}d retention`, value: pct(stats.retention_30d), accent: colors.brand600 },
    { icon: "fire", label: "Study streak", value: `${stats.streak}d`, accent: colors.orange400 },
    { icon: "checkCircle", label: "Mature", value: pct(maturePct), accent: colors.brand700 },
    { icon: "clock", label: "Avg interval", value: formatStability(stats.avg_stability), accent: colors.fgSecondary },
    { icon: "equalizer", label: "Avg difficulty", value: stats.avg_difficulty !== null ? `${stats.avg_difficulty.toFixed(1)}/10` : "—", accent: colors.fgSecondary },
    { icon: "calendar", label: `Reviews (${stats.retention_window_days}d)`, value: fmt(stats.reviews_30d), accent: colors.fgSecondary },
  ];

  return (
    <>
      <View style={styles.tileGrid}>
        {tiles.map((t) => (
          <View key={t.label} style={styles.tile}>
            <Icon name={t.icon} size={16} color={t.accent} />
            <Text style={styles.tileValue}>{t.value}</Text>
            <Text style={styles.tileLabel}>{t.label}</Text>
          </View>
        ))}
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Answer buttons</Text>
        <Text style={styles.blockHint}>
          Last {stats.rating_window_days} days · {fmt(ratingTotal)} reviews
        </Text>
        <View style={styles.barList}>
          <DistributionBar label="Again" value={stats.rating_distribution.again} total={ratingTotal} color={colors.gradeAgain} styles={styles} />
          <DistributionBar label="Hard" value={stats.rating_distribution.hard} total={ratingTotal} color={colors.orange300} styles={styles} />
          <DistributionBar label="Good" value={stats.rating_distribution.good} total={ratingTotal} color={colors.brand500} styles={styles} />
          <DistributionBar label="Easy" value={stats.rating_distribution.easy} total={ratingTotal} color={colors.brand700} styles={styles} />
        </View>
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Card maturity</Text>
        <Text style={styles.blockHint}>{fmt(maturityTotal)} active cards</Text>
        <View style={styles.barList}>
          <DistributionBar label="New" value={stats.maturity.new} total={maturityTotal} color={colors.brand300} styles={styles} />
          <DistributionBar label="Learning" value={stats.maturity.learning} total={maturityTotal} color={colors.orange300} styles={styles} />
          <DistributionBar label="Young" value={stats.maturity.young} total={maturityTotal} color={colors.brand400} styles={styles} />
          <DistributionBar label="Mature" value={stats.maturity.mature} total={maturityTotal} color={colors.brand700} styles={styles} />
        </View>
        {stats.maturity.suspended > 0 ? (
          <Text style={styles.blockHint}>{fmt(stats.maturity.suspended)} suspended (excluded)</Text>
        ) : null}
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Reviews per day</Text>
        <Text style={styles.blockHint}>Last {stats.reviews_per_day.length} days</Text>
        <MiniBars data={stats.reviews_per_day} color={colors.brand500} mode="history" colors={colors} styles={styles} />
      </View>

      <View style={styles.cardBlock}>
        <Text style={styles.blockTitle}>Upcoming reviews</Text>
        <Text style={styles.blockHint}>Becoming due over the next {stats.due_forecast.length} days</Text>
        <MiniBars data={stats.due_forecast} color={colors.orange300} mode="forecast" colors={colors} styles={styles} />
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
    scrim: {
      flex: 1,
      justifyContent: "flex-end",
    },
    scrimTap: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: colors.bgOverlay,
    },
    sheet: {
      backgroundColor: colors.bgCanvas,
      borderTopLeftRadius: radius.xl3,
      borderTopRightRadius: radius.xl3,
      paddingTop: 8,
      width: "100%",
      overflow: "hidden",
      flexDirection: "column",
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.borderPrimary,
      marginBottom: 8,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 20,
      paddingBottom: 8,
      gap: 12,
    },
    title: {
      flex: 1,
      fontSize: 18,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    chipScroll: {
      flexGrow: 0,
      flexShrink: 0,
      borderBottomWidth: 1,
      borderBottomColor: colors.borderSecondary,
    },
    chipRow: {
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 8,
      alignItems: "center",
    },
    chip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.borderPrimary,
      backgroundColor: colors.bgSurface,
      maxWidth: 180,
      minHeight: 36,
      alignItems: "center",
      justifyContent: "center",
    },
    chipActive: {
      backgroundColor: colors.brand500,
      borderColor: colors.brand500,
    },
    chipText: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    chipTextActive: {
      color: colors.fgOnBrand,
    },
    centered: {
      paddingVertical: 56,
      alignItems: "center",
      gap: 12,
    },
    errorText: {
      fontSize: 14,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    body: {
      flex: 1,
      minHeight: 0,
      paddingHorizontal: 16,
    },
    bodyContent: {
      paddingTop: 16,
      paddingBottom: 8,
      gap: 12,
    },
    inlineLoading: {
      alignItems: "center",
      paddingBottom: 4,
    },
    tileGrid: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 8,
    },
    tile: {
      width: "48%",
      flexGrow: 1,
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      paddingVertical: 12,
      paddingHorizontal: 14,
      gap: 2,
    },
    tileValue: {
      fontSize: 20,
      fontWeight: "700",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
      marginTop: 2,
    },
    tileLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgQuaternary,
      letterSpacing: 0,
    },
    cardBlock: {
      backgroundColor: colors.bgSurface,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      padding: 16,
      gap: 4,
    },
    blockTitle: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    blockHint: {
      fontSize: 12,
      color: colors.fgQuaternary,
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
      width: 64,
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    barTrack: {
      flex: 1,
      height: 8,
      borderRadius: 999,
      backgroundColor: colors.gray100,
      overflow: "hidden",
    },
    barFill: {
      height: "100%",
      borderRadius: 999,
    },
    barValue: {
      width: 78,
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgSecondary,
      textAlign: "right",
    },
    barPct: {
      fontSize: 11,
      fontWeight: "400",
      color: colors.fgQuaternary,
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
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
    },
    chartTick: {
      fontSize: 8,
      color: colors.fgQuaternary,
    },
    chartCaption: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 6,
    },
    chartCaptionText: {
      fontSize: 11,
      color: colors.fgQuaternary,
    },
    chartEmpty: {
      paddingVertical: 28,
      alignItems: "center",
    },
    chartEmptyText: {
      fontSize: 13,
      color: colors.fgQuaternary,
    },
  });
}
