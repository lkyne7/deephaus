import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import type { LeaderboardData, LeaderboardPeriod } from "@deephaus/api-client";
import { Card } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

const PERIODS: Array<{ value: LeaderboardPeriod; label: string }> = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
];

const TOP_ROWS = 5;

export function LeaderboardPanel() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const online = useOnline();

  const load = useCallback(
    async (target: LeaderboardPeriod) => {
      if (!online) {
        setLoading(false);
        setError("The leaderboard needs an internet connection.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        setData(await api.getLeaderboard(target));
      } catch {
        setError("Could not load the leaderboard.");
        setData(null);
      } finally {
        setLoading(false);
      }
    },
    [online],
  );

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const top = data?.entries.slice(0, TOP_ROWS) ?? [];
  const meInTop = top.some((entry) => entry.isMe);
  const showMeRow = Boolean(data?.me) && !meInTop;

  return (
    <Card padding={16}>
      <View style={styles.header}>
        <Text style={styles.title}>Leaderboard</Text>
        <SegmentedControl
          options={PERIODS}
          value={period}
          onChange={setPeriod}
          accessibilityLabel="Leaderboard period"
        />
      </View>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : top.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            No reviews yet for this period.
          </Text>
        </View>
      ) : (
        <View style={styles.rows}>
          {top.map((entry) => (
            <LeaderboardRow
              key={`${entry.rank}-${entry.username}`}
              rank={entry.rank}
              username={entry.username}
              reviews={entry.reviews}
              isMe={entry.isMe}
              styles={styles}
              colors={colors}
            />
          ))}
          {showMeRow && data?.me ? (
            <>
              <View style={styles.meDivider} />
              <LeaderboardRow
                rank={data.me.rank}
                username="You"
                reviews={data.me.reviews}
                isMe
                styles={styles}
                colors={colors}
              />
            </>
          ) : null}
        </View>
      )}
    </Card>
  );
}

function LeaderboardRow({
  rank,
  username,
  reviews,
  isMe,
  styles,
  colors,
}: {
  rank: number;
  username: string;
  reviews: number;
  isMe: boolean;
  styles: ReturnType<typeof createStyles>;
  colors: ThemeColors;
}) {
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <Text style={styles.rankText}>{rank}</Text>
      <Text style={[styles.username, isMe && { color: colors.accentInk }]} numberOfLines={1}>
        {username}
        {isMe && username !== "You" ? " (you)" : ""}
      </Text>
      <Text style={styles.reviews}>{reviews.toLocaleString()}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    header: {
      gap: 10,
      marginBottom: 12,
    },
    title: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    stateBox: {
      paddingVertical: 18,
      alignItems: "center",
    },
    stateText: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    rows: {
      gap: 4,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: radius.lg,
    },
    rowMe: {
      backgroundColor: colors.accentSoft,
    },
    meDivider: {
      height: 1,
      backgroundColor: colors.line,
      marginVertical: 4,
    },
    rankText: {
      width: 20,
      fontSize: 13,
      color: colors.fgTertiary,
    },
    username: {
      flex: 1,
      fontSize: 14,
      color: colors.fgPrimary,
    },
    reviews: {
      fontSize: 13,
      color: colors.fgSecondary,
    },
  });
}
