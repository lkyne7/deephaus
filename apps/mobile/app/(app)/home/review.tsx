import type { BrowseCardRow } from "@deephaus/api-client";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { runCardBatchAction } from "@/components/card-batch-toolbar";
import { CardListItem } from "@/components/card-list-item";
import { Button } from "@/components/ui/button";
import { NativeContextMenu } from "@/components/ui/native-menu";
import { ScreenHeader } from "@/components/ui/screen-header";
import { plainCardText } from "@/lib/card-preview";
import { loadJobCards } from "@/lib/job-cards";
import { goBackOrReplace } from "@/lib/navigation";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** A quick pass over one generation run's cards before studying them. */
export default function ReviewNewCardsScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { deck, job, name } = useLocalSearchParams<{
    deck: string;
    job: string;
    name?: string;
  }>();
  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    if (!deck || !job) return;
    if (!loadedOnceRef.current) setLoading(true);
    try {
      setCards((await loadJobCards(deck, job)).cards);
      loadedOnceRef.current = true;
    } catch (reason) {
      // Keep what's on screen; a first load that fails says why.
      if (!loadedOnceRef.current) {
        Alert.alert(
          "Couldn't load the new cards",
          reason instanceof Error ? reason.message : "Try again in a moment.",
        );
      }
    } finally {
      setLoading(false);
    }
  }, [deck, job]);

  // Reload on return, so edits made in the card editor show.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  async function remove(ids: string[]) {
    if (!(await runCardBatchAction("delete", ids))) return;
    const gone = new Set(ids);
    const remaining = cards.filter((card) => !gone.has(card.id));
    setCards(remaining);
    if (remaining.length === 0) goBackOrReplace("/home");
  }

  const count = cards.length;
  const openCard = (cardId: string) => router.push(`/home/card/${cardId}`);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={loading ? "New cards" : `${count} new card${count === 1 ? "" : "s"}`}
        backFallback="/home"
      />
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <Text style={styles.helper}>Tap to edit. Press and hold to remove.</Text>
        }
        ListEmptyComponent={
          loading ? <ActivityIndicator color={colors.accent} style={styles.loading} /> : null
        }
        renderItem={({ item: card }) => {
          const front = plainCardText(card.type === "basic" ? card.front : card.cloze_text);
          return (
            <NativeContextMenu
              label={front}
              entries={[
                { label: "Edit", sfIcon: "pencil", onPress: () => openCard(card.id) },
                {
                  label: "Remove",
                  sfIcon: "trash",
                  destructive: true,
                  onPress: () => void remove([card.id]),
                },
              ]}
            >
              {({ onLongPress }) => (
                <CardListItem
                  card={card}
                  onPress={() => openCard(card.id)}
                  onLongPress={onLongPress}
                  accessibilityHint="Opens the card. Press and hold to remove it."
                />
              )}
            </NativeContextMenu>
          );
        }}
        ListFooterComponent={
          count > 0 ? (
            <View style={styles.footer}>
              <Button
                label={name ? `Study ${name}` : "Study deck"}
                fullWidth
                onPress={() => router.push(`/study/${deck}`)}
              />
              <Button
                variant="tertiary"
                label={count === 1 ? "Remove this card" : `Remove all ${count}`}
                fullWidth
                onPress={() => void remove(cards.map((card) => card.id))}
              />
            </View>
          ) : null
        }
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 32 },
    helper: {
      paddingHorizontal: 4,
      paddingBottom: 10,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    loading: { marginTop: 24 },
    footer: { gap: 4, paddingTop: 16 },
    pressed: { opacity: 0.6 },
  });
}
