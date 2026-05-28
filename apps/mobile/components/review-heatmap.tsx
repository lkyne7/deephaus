import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

const CELL = 11;
const GAP = 3;
const WEEKS = 53;

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function heatRamp(colors: {
  gray100: string;
  brand600: string;
}) {
  return [
    colors.gray100,
    "rgba(79, 179, 177, 0.30)",
    "rgba(79, 179, 177, 0.55)",
    "rgba(49, 151, 149, 0.80)",
    colors.brand600,
  ];
}

function colorForCount(count: number, heat: string[]) {
  if (count <= 0) return heat[0];
  if (count === 1) return heat[1];
  if (count <= 3) return heat[2];
  if (count <= 6) return heat[3];
  return heat[4];
}

export function ReviewHeatmap({
  year,
  counts,
}: {
  year: number;
  counts: Record<string, number>;
}) {
  const { colors } = useTheme();
  const heat = useMemo(() => heatRamp(colors), [colors]);
  const styles = useMemo(
    () =>
      StyleSheet.create({
        wrap: { gap: 10 },
        legendRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "flex-end",
          gap: 6,
        },
        legendText: {
          fontSize: 11,
          color: colors.fgQuaternary,
          fontWeight: "500",
        },
        legendCells: {
          flexDirection: "row",
          gap: 3,
        },
        legendCell: {
          width: 12,
          height: 12,
          borderRadius: radius.xs,
        },
      }),
    [colors],
  );

  const cells = useMemo(() => {
    const start = new Date(year, 0, 1);
    const end = year === new Date().getFullYear() ? new Date() : new Date(year, 11, 31);
    const startDay = start.getDay();
    const result: Array<{ x: number; y: number; count: number; key: string }> = [];

    const cursor = new Date(start);
    let dayIndex = 0;
    while (cursor <= end) {
      const week = Math.floor((dayIndex + startDay) / 7);
      const weekday = (dayIndex + startDay) % 7;
      const key = toDayKey(cursor);
      result.push({ x: week, y: weekday, count: counts[key] ?? 0, key });
      cursor.setDate(cursor.getDate() + 1);
      dayIndex += 1;
    }
    return result;
  }, [counts, year]);

  const width = WEEKS * (CELL + GAP);
  const height = 7 * (CELL + GAP);

  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Svg width={width} height={height}>
          {cells.map((cell) => (
            <Rect
              key={cell.key}
              x={cell.x * (CELL + GAP)}
              y={cell.y * (CELL + GAP)}
              width={CELL}
              height={CELL}
              rx={2}
              fill={colorForCount(cell.count, heat)}
            />
          ))}
        </Svg>
      </ScrollView>
      <View style={styles.legendRow}>
        <Text style={styles.legendText}>Less</Text>
        <View style={styles.legendCells}>
          {heat.map((c, i) => (
            <View key={i} style={[styles.legendCell, { backgroundColor: c }]} />
          ))}
        </View>
        <Text style={styles.legendText}>More</Text>
      </View>
    </View>
  );
}
