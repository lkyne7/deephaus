import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { ReviewHeatmap } from "@/components/review-heatmap";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MutedText, ScreenTitle } from "@/components/ui/text";
import { useAuth } from "@/lib/auth-context";
import { api } from "@/lib/api";
import { theme } from "@/lib/theme";
import type { DashboardStats } from "@deephaus/api-client";

export default function DashboardScreen() {
  const { signOut } = useAuth();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [year, setYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dashboard, heatmapData] = await Promise.all([
        api.getDashboardStats(),
        api.getReviewHeatmap(year),
      ]);
      setStats(dashboard);
      setHeatmap(heatmapData.counts);
    } catch {
      setStats(null);
      setHeatmap({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={theme.colors.accent} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={theme.colors.accent} />}
    >
      <View style={styles.headerRow}>
        <ScreenTitle>Dashboard</ScreenTitle>
        <Pressable onPress={() => void signOut()}>
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>

      {stats && (
        <>
          <View style={styles.statsGrid}>
            <StatCard label="Reviewed today" value={String(stats.reviewed_today)} />
            <StatCard label="Streak" value={`${stats.streak}d`} />
            <StatCard
              label="Retention"
              value={stats.retention_pct != null ? `${Math.round(stats.retention_pct * 100)}%` : "—"}
            />
            <StatCard label="Due now" value={String(stats.due_now)} />
          </View>

          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Card states</Text>
            <View style={styles.breakdownRow}>
              <BreakdownChip label="New" value={stats.state_breakdown.new} />
              <BreakdownChip label="Learning" value={stats.state_breakdown.learning} />
              <BreakdownChip label="Review" value={stats.state_breakdown.review} />
              <BreakdownChip label="Relearning" value={stats.state_breakdown.relearning} />
            </View>
          </Card>

          <Card style={styles.section}>
            <View style={styles.heatmapHeader}>
              <Text style={styles.sectionTitle}>Review activity</Text>
              <View style={styles.yearRow}>
                <Pressable onPress={() => setYear((y) => y - 1)}>
                  <Text style={styles.yearBtn}>‹</Text>
                </Pressable>
                <Text style={styles.yearText}>{year}</Text>
                <Pressable onPress={() => setYear((y) => y + 1)}>
                  <Text style={styles.yearBtn}>›</Text>
                </Pressable>
              </View>
            </View>
            <ReviewHeatmap year={year} counts={heatmap} />
          </Card>

          <Text style={styles.sectionTitle}>Your decks</Text>
          {stats.per_deck.length === 0 ? (
            <MutedText>No decks yet. Create one to get started.</MutedText>
          ) : (
            stats.per_deck.map((deck) => (
              <Card key={deck.deck_id} style={styles.deckCard}>
                <Text style={styles.deckName}>{deck.name}</Text>
                <MutedText>
                  {deck.due} due · {deck.new} new · {deck.total} total
                </MutedText>
                <Button
                  label="Study"
                  style={styles.studyBtn}
                  onPress={() => router.push(`/(tabs)/study/${deck.deck_id}`)}
                />
              </Card>
            ))
          )}
        </>
      )}
    </ScrollView>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card style={styles.statCard}>
      <Text style={styles.statValue}>{value}</Text>
      <MutedText>{label}</MutedText>
    </Card>
  );
}

function BreakdownChip({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipValue}>{value}</Text>
      <Text style={styles.chipLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  center: { flex: 1, justifyContent: "center", backgroundColor: theme.colors.background },
  headerRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  signOut: { color: theme.colors.muted, fontSize: 14 },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard: { width: "48%", flexGrow: 1 },
  statValue: { color: theme.colors.text, fontSize: 28, fontWeight: "700" },
  section: { gap: 10 },
  sectionTitle: { color: theme.colors.text, fontSize: 18, fontWeight: "700" },
  breakdownRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 8,
    alignItems: "center",
    minWidth: 72,
  },
  chipValue: { color: theme.colors.text, fontWeight: "700" },
  chipLabel: { color: theme.colors.muted, fontSize: 11 },
  heatmapHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  yearRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  yearBtn: { color: theme.colors.accent, fontSize: 20, paddingHorizontal: 8 },
  yearText: { color: theme.colors.text, fontWeight: "600" },
  deckCard: { gap: 6 },
  deckName: { color: theme.colors.text, fontWeight: "600", fontSize: 16 },
  studyBtn: { marginTop: 4 },
});
