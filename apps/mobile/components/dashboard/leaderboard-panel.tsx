import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { LeaderboardData, LeaderboardPeriod } from "@deephaus/api-client";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { api } from "@/lib/api";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
  { id: "all", label: "All time" },
];

const TOP_ROWS = 5;

export function LeaderboardPanel() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (target: LeaderboardPeriod) => {
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
  }, []);

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const top = data?.entries.slice(0, TOP_ROWS) ?? [];
  const meInTop = top.some((entry) => entry.isMe);
  const showMeRow = Boolean(data?.me) && !meInTop;

  return (
    <Card padding={16}>
      <View style={styles.headerRow}>
        <View style={styles.titleRow}>
          <Icon name="trophy" size={16} color={colors.brand600} />
          <Text style={styles.title}>Leaderboard</Text>
        </View>
        <View style={styles.segments}>
          {PERIODS.map((option) => {
            const active = option.id === period;
            return (
              <Pressable
                key={option.id}
                onPress={() => setPeriod(option.id)}
                hitSlop={4}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {loading ? (
        <View style={styles.stateBox}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : error ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>{error}</Text>
        </View>
      ) : top.length === 0 ? (
        <View style={styles.stateBox}>
          <Text style={styles.stateText}>
            No reviews yet for this period. Be the first on the board!
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
  const medal = rank === 1 ? "#EAB308" : rank === 2 ? "#94A3B8" : rank === 3 ? "#B45309" : null;
  return (
    <View style={[styles.row, isMe && styles.rowMe]}>
      <View style={[styles.rankBadge, medal ? { backgroundColor: `${medal}22` } : null]}>
        <Text style={[styles.rankText, medal ? { color: medal } : null]}>{rank}</Text>
      </View>
      <Text style={[styles.username, isMe && { color: colors.brand700 }]} numberOfLines={1}>
        {username}
        {isMe && username !== "You" ? " (you)" : ""}
      </Text>
      <Text style={styles.reviews}>{reviews.toLocaleString()}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
      gap: 8,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    title: {
      fontSize: 15,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    segments: {
      flexDirection: "row",
      backgroundColor: colors.gray50,
      borderRadius: 8,
      padding: 2,
    },
    segment: {
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
    },
    segmentActive: {
      backgroundColor: colors.bgCanvas,
    },
    segmentText: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
    },
    segmentTextActive: {
      color: colors.fgPrimary,
      fontWeight: "600",
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
      borderRadius: 8,
    },
    rowMe: {
      backgroundColor: colors.brand50,
    },
    meDivider: {
      height: 1,
      backgroundColor: colors.borderSecondary,
      marginVertical: 4,
    },
    rankBadge: {
      width: 26,
      height: 26,
      borderRadius: 999,
      backgroundColor: colors.gray50,
      alignItems: "center",
      justifyContent: "center",
    },
    rankText: {
      fontSize: 12,
      fontWeight: "700",
      color: colors.fgSecondary,
    },
    username: {
      flex: 1,
      fontSize: 14,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    reviews: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgSecondary,
    },
  });
}
