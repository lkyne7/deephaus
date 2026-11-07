import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  AdvancedStatsContent,
  type AdvancedStatsDeckOption,
} from "@/components/dashboard/advanced-stats-sheet";
import { LeaderboardPanel } from "@/components/dashboard/leaderboard-panel";
import { ReviewHeatmap } from "@/components/review-heatmap";
import { Card } from "@/components/ui/card";
import { DeckSelect } from "@/components/ui/deck-select";
import { newCardsAction, ScreenHeader } from "@/components/ui/screen-header";
import { deckDisplayName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export default function InsightsScreen() {
  const { deckId } = useLocalSearchParams<{ deckId?: string }>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [deckOptions, setDeckOptions] =
    useState<AdvancedStatsDeckOption[] | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  const [heatmap, setHeatmap] = useState<Record<string, number>>({});
  const [heatmapForecast, setHeatmapForecast] = useState<Record<string, number>>({});

  useEffect(() => {
    let active = true;
    void offlineData
      .listDecks()
      .then(({ decks }) => {
        if (!active) return;
        setDeckOptions(
          decks.map((deck) => ({
            id: deck.id,
            title: deckDisplayName(deck.title),
          })),
        );
      })
      .catch(() => {
        if (active) setDeckOptions([]);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void offlineData
      .getReviewHeatmap(year)
      .then((data) => {
        if (!active) return;
        setHeatmap(data.counts);
        setHeatmapForecast(data.forecast ?? {});
      })
      .catch(() => {
        if (!active) return;
        setHeatmap({});
        setHeatmapForecast({});
      });
    return () => {
      active = false;
    };
  }, [year]);

  const initialDeckId = useMemo(
    () => (typeof deckId === "string" && deckId ? deckId : null),
    [deckId],
  );

  const yearOptions = useMemo(() => {
    const current = new Date().getFullYear();
    return [current, current - 1, current - 2].map((y) => ({ id: String(y), label: String(y) }));
  }, []);

  return (
    <View style={styles.root}>
      <ScreenHeader sidebar title="Insights" actions={[newCardsAction]} />
      {deckOptions ? (
        <AdvancedStatsContent
          deckOptions={deckOptions}
          initialDeckId={initialDeckId}
          activity={
            <Card padding={16}>
              <View style={styles.activityHeader}>
                <Text style={styles.activityTitle}>Activity</Text>
                <DeckSelect
                  small
                  value={String(year)}
                  title="Year"
                  options={yearOptions}
                  selectedId={String(year)}
                  onSelect={(opt) => setYear(parseInt(opt.id, 10))}
                  style={styles.yearSelect}
                />
              </View>
              <ReviewHeatmap year={year} counts={heatmap} forecast={heatmapForecast} />
            </Card>
          }
        >
          <LeaderboardPanel />
        </AdvancedStatsContent>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    center: { flex: 1, alignItems: "center", justifyContent: "center" },
    activityHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 12,
    },
    activityTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    // The select fills its parent, so in a row it needs a set width.
    yearSelect: { width: 96 },
  });
}
