import { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Rect } from "react-native-svg";
import { theme } from "@/lib/theme";

const CELL = 10;
const GAP = 2;
const WEEKS = 53;

function toDayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function colorForCount(count: number) {
  if (count <= 0) return theme.colors.border;
  if (count === 1) return "rgba(91, 159, 212, 0.35)";
  if (count <= 3) return "rgba(91, 159, 212, 0.55)";
  if (count <= 6) return "rgba(91, 159, 212, 0.75)";
  return theme.colors.accent;
}

export function ReviewHeatmap({ year, counts }: { year: number; counts: Record<string, number> }) {
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
              fill={colorForCount(cell.count)}
            />
          ))}
        </Svg>
      </ScrollView>
      <Text style={styles.legend}>Less · More reviews</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  legend: { color: theme.colors.muted, fontSize: 12 },
});
