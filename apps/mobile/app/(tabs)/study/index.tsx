import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import {
  DeckActionsSheet,
  type DeckActionsDeck,
} from "@/components/deck-actions-sheet";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { DeckLogo, ownedDeckLogoKind } from "@/components/ui/deck-logo";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { UIText } from "@/components/ui/text";
import { formatDeckName } from "@/lib/deck-name";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { StudyDeckOption } from "@deephaus/api-client";

type DeckFilter = "all" | "due" | "new";

export default function StudyHubScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [decks, setDecks] = useState<StudyDeckOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionsDeck, setActionsDeck] = useState<DeckActionsDeck | null>(null);
  const [search, setSearch] = useState("");
  const [deckFilter, setDeckFilter] = useState<DeckFilter>("all");

  const load = useCallback(async () => {
    try {
      const [{ decks: items }, stats] = await Promise.all([
        offlineData.listDecks(),
        offlineData.getDashboardStats().catch(() => null),
      ]);
      const originById = new Map(
        (stats?.per_deck ?? []).map((deck) => [deck.deck_id, deck]),
      );
      setDecks(
        items.map((deck) => {
          const origin = originById.get(deck.id);
          return {
            ...deck,
            is_community: deck.is_community ?? origin?.is_community,
            is_published: deck.is_published ?? origin?.is_published,
          };
        }),
      );
    } catch {
      setDecks([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const hasDue = decks.some((d) => d.due + d.new > 0);
  const visibleDecks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    let filtered = decks;
    if (deckFilter === "due") {
      filtered = filtered.filter((deck) => deck.due > 0);
    } else if (deckFilter === "new") {
      filtered = filtered.filter((deck) => deck.new > 0);
    }
    if (query) {
      filtered = filtered.filter((deck) =>
        deck.title.toLocaleLowerCase().includes(query),
      );
    }
    return [...filtered].sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
  }, [decks, search, deckFilter]);

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Study"
        search={{
          placeholder: "Search decks",
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={[
          {
            icon: "bolt",
            sfIcon: "bolt",
            label: "Cram plans",
            placement: "left",
            onPress: () => {
              haptics.light();
              router.push("/(tabs)/study/cram");
            },
          },
          {
            type: "menu",
            icon: "filter",
            sfIcon: "line.3.horizontal.decrease",
            label: "Filter decks",
            items: [
              {
                label: "All decks",
                sfIcon: "square.grid.2x2",
                selected: deckFilter === "all",
                onPress: () => setDeckFilter("all"),
              },
              {
                label: "Due today",
                sfIcon: "clock",
                selected: deckFilter === "due",
                onPress: () => setDeckFilter("due"),
              },
              {
                label: "New cards",
                sfIcon: "sparkles",
                selected: deckFilter === "new",
                onPress: () => setDeckFilter("new"),
              },
            ],
          },
        ]}
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand500} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.brand500}
            />
          }
        >
          {Platform.OS !== "ios" ? (
            <Field
              leadingIcon="search"
              placeholder="Search decks"
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
            />
          ) : null}

          {decks.length === 0 ? (
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="book" variant="brand" size="lg" />
              <UIText variant="subtitle" style={styles.emptyTitle}>
                No decks yet
              </UIText>
              <UIText variant="muted" style={styles.emptyBody}>
                Create a deck or subscribe to a community deck to start studying.
              </UIText>
              <Button
                variant="brand"
                size="md"
                label="Create a deck"
                onPress={() => router.push("/(tabs)/create")}
                style={{ marginTop: 12 }}
              />
            </Card>
          ) : (
            <>
              {!hasDue && (
                <Card padding={16} style={{ gap: 6 }}>
                  <UIText variant="subtitle" style={styles.allCaughtUp}>
                    All caught up
                  </UIText>
                  <UIText variant="muted">
                    No cards are due right now. Check back later, or study ahead from a deck below.
                  </UIText>
                </Card>
              )}
              {visibleDecks.map((deck) => {
                const deckName = formatDeckName(deck.title);
                return (
                <Pressable
                  key={deck.id}
                  onPress={() => router.push(`/(tabs)/study/${deck.id}`)}
                  style={({ pressed }) => [pressed && { opacity: 0.85 }]}
                >
                  <Card padding={14} style={{ gap: 12 }}>
                    <View style={styles.titleRow}>
                      <DeckLogo kind={ownedDeckLogoKind(deck)} />
                      <View style={styles.titleCol}>
                        {deckName.path != null && (
                          <UIText variant="label" style={styles.deckPath} numberOfLines={1}>
                            {deckName.path}
                          </UIText>
                        )}
                        <UIText variant="subtitle" style={styles.deckTitle} numberOfLines={2}>
                          {deckName.title}
                        </UIText>
                      </View>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation?.();
                          setActionsDeck({
                            id: deck.id,
                            title: deck.title,
                            cardCount: deck.due + deck.new + deck.waiting,
                          });
                        }}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel={`Actions for ${deck.title}`}
                        style={styles.moreBtn}
                      >
                        <Icon name="more" size={18} color={colors.fgQuaternary} />
                      </Pressable>
                    </View>
                    <View style={styles.badges}>
                      {deck.due > 0 && (
                        <BadgePill icon="clock" label={`${deck.due} due`} tone="orange" />
                      )}
                      {deck.new > 0 && (
                        <BadgePill
                          icon="sparklesOutline"
                          label={`${deck.new} new`}
                          tone="brand"
                        />
                      )}
                      {deck.waiting > 0 && (
                        <BadgePill icon="bookmark" label={`${deck.waiting} waiting`} tone="gray" />
                      )}
                      {deck.due + deck.new === 0 && (
                        <BadgePill icon="check" label="Caught up" tone="good" />
                      )}
                    </View>
                    <ProgressBar
                      value={
                        deck.due + deck.new + deck.waiting === 0
                          ? 1
                          : deck.waiting / (deck.due + deck.new + deck.waiting)
                      }
                      height={4}
                    />
                  </Card>
                </Pressable>
                );
              })}
              {decks.length > 0 && visibleDecks.length === 0 ? (
                <Card padding={20} style={styles.empty}>
                  <FeaturedIcon icon="search" variant="gray" size="lg" />
                  <UIText variant="subtitle" style={styles.emptyTitle}>
                    No matching decks
                  </UIText>
                  <UIText variant="muted" style={styles.emptyBody}>
                    Try a different deck name.
                  </UIText>
                </Card>
              ) : null}
            </>
          )}
        </ScrollView>
      )}
      <DeckActionsSheet
        visible={actionsDeck != null}
        deck={actionsDeck}
        omit={["study"]}
        onClose={() => setActionsDeck(null)}
        onRenamed={(name) => {
          if (!actionsDeck) return;
          setDecks((prev) =>
            prev.map((d) => (d.id === actionsDeck.id ? { ...d, title: name } : d)),
          );
          setActionsDeck((prev) => (prev ? { ...prev, title: name } : prev));
        }}
        onDuplicated={() => {
          void load();
        }}
        onDeleted={(deckId) => {
          setDecks((prev) => prev.filter((d) => d.id !== deckId));
          setActionsDeck(null);
        }}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { padding: 16, gap: 10 },
    empty: { alignItems: "center", gap: 4 },
    emptyTitle: { marginTop: 12 },
    emptyBody: { textAlign: "center" },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
    },
    title: { flex: 1 },
    titleCol: {
      flex: 1,
      minWidth: 0,
      gap: 1,
    },
    deckTitle: { lineHeight: 22 },
    deckPath: { fontSize: 11 },
    moreBtn: {
      width: 32,
      height: 32,
      alignItems: "center",
      justifyContent: "center",
      marginRight: -4,
    },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    allCaughtUp: { color: colors.brand700 },
  });
}
