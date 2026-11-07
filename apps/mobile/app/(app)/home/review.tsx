import type { BrowseCardRow } from "@deephaus/api-client";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { runCardBatchAction } from "@/components/card-batch-toolbar";
import { Button } from "@/components/ui/button";
import { NativeContextMenu } from "@/components/ui/native-menu";
import { ScreenHeader } from "@/components/ui/screen-header";
import { plainCardText } from "@/lib/card-preview";
import { serifFont } from "@/lib/fonts";
import { loadJobCards } from "@/lib/job-cards";
import { goBackOrReplace } from "@/lib/navigation";
import { radius, type ThemeColors } from "@/lib/theme";
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
        renderItem={({ item: card, index }) => {
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
                <Pressable
                  onPress={() => openCard(card.id)}
                  onLongPress={onLongPress}
                  accessibilityRole="button"
                  accessibilityHint="Opens the card. Press and hold to remove it."
                  style={({ pressed }) => [
                    styles.row,
                    index === 0 && styles.rowFirst,
                    index === count - 1 && styles.rowLast,
                    index > 0 && styles.rowLine,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.front} numberOfLines={3}>
                    {front}
                  </Text>
                  {card.type === "basic" && card.back ? (
                    <Text style={styles.back} numberOfLines={2}>
                      {plainCardText(card.back)}
                    </Text>
                  ) : null}
                </Pressable>
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
    content: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32 },
    helper: {
      paddingHorizontal: 4,
      paddingBottom: 10,
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
    loading: { marginTop: 24 },
    row: {
      gap: 2,
      paddingHorizontal: 14,
      paddingVertical: 12,
      backgroundColor: colors.bgSurface,
    },
    rowFirst: { borderTopLeftRadius: radius.xl4, borderTopRightRadius: radius.xl4 },
    rowLast: { borderBottomLeftRadius: radius.xl4, borderBottomRightRadius: radius.xl4 },
    rowLine: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
    front: { ...serifFont(), fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    back: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    footer: { gap: 4, paddingTop: 16 },
    pressed: { opacity: 0.6 },
  });
}
