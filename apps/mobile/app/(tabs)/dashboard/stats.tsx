import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import {
  AdvancedStatsContent,
  type AdvancedStatsDeckOption,
} from "@/components/dashboard/advanced-stats-sheet";
import { ScreenHeader } from "@/components/ui/screen-header";
import { deckDisplayName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import { useTheme } from "@/lib/theme-context";

export default function DashboardStatsScreen() {
  const { deckId } = useLocalSearchParams<{ deckId?: string }>();
  const { colors } = useTheme();
  const [deckOptions, setDeckOptions] =
    useState<AdvancedStatsDeckOption[] | null>(null);

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

  const initialDeckId = useMemo(
    () => (typeof deckId === "string" && deckId ? deckId : null),
    [deckId],
  );

  return (
    <View style={[styles.root, { backgroundColor: colors.bgCanvas }]}>
      <ScreenHeader
        title="Stats"
        backFallback="/(tabs)/dashboard"
        actions={[
          {
            icon: "close",
            sfIcon: "xmark",
            label: "Close stats",
            onPress: () => router.back(),
          },
        ]}
      />
      {deckOptions ? (
        <AdvancedStatsContent
          deckOptions={deckOptions}
          initialDeckId={initialDeckId}
        />
      ) : (
        <View style={styles.center}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
});
