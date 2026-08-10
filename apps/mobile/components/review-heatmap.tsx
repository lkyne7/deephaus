import { computeHeatmapStats, formatDailyAverage } from "@deephaus/shared";
import { useMemo, useRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Rect, Text as SvgText } from "react-native-svg";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

const CELL = 11;
const GAP = 3;
const STEP = CELL + GAP;
const LABEL_WIDTH = 26;
const HEADER_HEIGHT = 16;

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"] as const;
const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

type Cell = {
  key: string;
  week: number;
  weekday: number;
  count: number;
  future: boolean;
  today: boolean;
};

/** Local-time date key so cells line up with the user's calendar, not UTC. */
function toDayKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function reviewRamp(colors: ThemeColors) {
  return [
    colors.gray100,
    "rgba(79, 179, 177, 0.30)",
    "rgba(79, 179, 177, 0.55)",
    "rgba(49, 151, 149, 0.80)",
    colors.brand600,
  ];
}

function forecastRamp(colors: ThemeColors) {
  return [
    colors.gray100,
    "rgba(243, 135, 68, 0.25)",
    "rgba(243, 135, 68, 0.48)",
    "rgba(243, 135, 68, 0.72)",
    colors.orange400,
  ];
}

function levelForCount(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

export function ReviewHeatmap({
  year,
  counts,
  forecast = {},
}: {
  year: number;
  counts: Record<string, number>;
  forecast?: Record<string, number>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reviewHeat = useMemo(() => reviewRamp(colors), [colors]);
  const forecastHeat = useMemo(() => forecastRamp(colors), [colors]);
  const scrollRef = useRef<ScrollView>(null);

  const { cells, weekCount, monthTicks, todayWeek } = useMemo(() => {
    const todayKey = toDayKey(new Date());
    const jan1 = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);

    // Start the grid on the Monday on/before Jan 1 so weekday rows line up.
    const start = new Date(jan1);
    const dow = start.getDay();
    start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow));

    const result: Cell[] = [];
    const ticks: Array<{ label: string; week: number }> = [];
    let lastMonth = -1;
    let currentWeek: number | null = null;
    const cursor = new Date(start);
    let index = 0;

    while (cursor <= yearEnd) {
      const week = Math.floor(index / 7);
      const weekday = index % 7;

      if (cursor.getFullYear() === year) {
        const key = toDayKey(cursor);
        const future = key > todayKey;
        const isToday = key === todayKey;
        if (isToday) currentWeek = week;
        result.push({
          key,
          week,
          weekday,
          count: future ? (forecast[key] ?? 0) : (counts[key] ?? 0),
          future,
          today: isToday,
        });

        const month = cursor.getMonth();
        if (month !== lastMonth) {
          ticks.push({ label: MONTH_LABELS[month]!, week });
          lastMonth = month;
        }
      }

      cursor.setDate(cursor.getDate() + 1);
      index += 1;
    }

    return {
      cells: result,
      weekCount: Math.ceil(index / 7),
      monthTicks: ticks,
      todayWeek: currentWeek,
    };
  }, [counts, forecast, year]);

  const { maxReview, maxForecast } = useMemo(() => {
    let maxR = 0;
    let maxF = 0;
    for (const count of Object.values(counts)) if (count > maxR) maxR = count;
    for (const count of Object.values(forecast)) if (count > maxF) maxF = count;
    return { maxReview: maxR, maxForecast: maxF };
  }, [counts, forecast]);

  const stats = useMemo(() => computeHeatmapStats(counts, year), [counts, year]);

  const summaryStats = [
    { label: "Daily average", value: `${formatDailyAverage(stats.dailyAverage)} reviews` },
    { label: "Days learned", value: `${Math.round(stats.daysLearnedPct * 100)}%` },
    {
      label: "Longest streak",
      value: `${stats.longestStreak} day${stats.longestStreak === 1 ? "" : "s"}`,
    },
    {
      label: "Current streak",
      value: `${stats.currentStreak} day${stats.currentStreak === 1 ? "" : "s"}`,
    },
  ];

  const gridWidth = weekCount * STEP;
  const svgHeight = HEADER_HEIGHT + 7 * STEP;

  return (
    <View style={styles.wrap}>
      <View style={styles.chartRow}>
        <Svg width={LABEL_WIDTH} height={svgHeight}>
          {DAY_LABELS.map((label, row) =>
            label ? (
              <SvgText
                key={label}
                x={0}
                y={HEADER_HEIGHT + row * STEP + CELL - 1}
                fontSize={9}
                fill={colors.fgQuaternary}
              >
                {label}
              </SvgText>
            ) : null,
          )}
        </Svg>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          onContentSizeChange={() => {
            // Land on the current week so today (and the projections just after
            // it) are visible without scrolling; past years open at the end.
            const target =
              todayWeek != null ? Math.max(0, (todayWeek - 8) * STEP) : gridWidth;
            scrollRef.current?.scrollTo({ x: target, animated: false });
          }}
        >
          <Svg width={gridWidth} height={svgHeight}>
            {monthTicks.map((tick) => (
              <SvgText
                key={`${tick.label}-${tick.week}`}
                x={tick.week * STEP}
                y={9}
                fontSize={9}
                fill={colors.fgQuaternary}
              >
                {tick.label}
              </SvgText>
            ))}
            {cells.map((cell) => {
              const ramp = cell.future ? forecastHeat : reviewHeat;
              const level = levelForCount(cell.count, cell.future ? maxForecast : maxReview);
              return (
                <Rect
                  key={cell.key}
                  x={cell.week * STEP}
                  y={HEADER_HEIGHT + cell.weekday * STEP}
                  width={CELL}
                  height={CELL}
                  rx={2}
                  fill={ramp[level]}
                  stroke={cell.today ? colors.fgPrimary : undefined}
                  strokeWidth={cell.today ? 1.5 : 0}
                />
              );
            })}
          </Svg>
        </ScrollView>
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legend}>
          <Text style={styles.legendText}>Reviews</Text>
          <View style={styles.legendCells}>
            {reviewHeat.map((c, i) => (
              <View key={`r-${i}`} style={[styles.legendCell, { backgroundColor: c }]} />
            ))}
          </View>
        </View>
        <View style={styles.legend}>
          <Text style={styles.legendText}>Projected</Text>
          <View style={styles.legendCells}>
            {forecastHeat.map((c, i) => (
              <View key={`f-${i}`} style={[styles.legendCell, { backgroundColor: c }]} />
            ))}
          </View>
        </View>
      </View>

      <View style={styles.statsRow}>
        {summaryStats.map((stat) => (
          <View key={stat.label} style={styles.stat}>
            <Text style={styles.statValue}>{stat.value}</Text>
            <Text style={styles.statLabel}>{stat.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    wrap: { gap: 12 },
    chartRow: { flexDirection: "row", alignItems: "flex-start" },
    legendRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 14,
    },
    legend: { flexDirection: "row", alignItems: "center", gap: 5 },
    legendText: {
      fontSize: 11,
      color: colors.fgQuaternary,
      fontWeight: "500",
    },
    legendCells: { flexDirection: "row", gap: 3 },
    legendCell: {
      width: 10,
      height: 10,
      borderRadius: radius.xs,
    },
    statsRow: {
      flexDirection: "row",
      flexWrap: "wrap",
      justifyContent: "space-between",
      gap: 12,
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
      paddingTop: 12,
    },
    stat: { gap: 1, minWidth: 0 },
    statValue: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    statLabel: {
      fontSize: 11,
      color: colors.fgQuaternary,
    },
  });
}
