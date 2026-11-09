import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useDeckActions, type DeckActionsDeck } from "@/components/deck-actions";
import { LoadError } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterPills } from "@/components/ui/filter-pills";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { NativeContextMenu, NativeMenu } from "@/components/ui/native-menu";
import {
  newCardsAction,
  ScreenHeader,
  searchListKeyboardDismiss,
} from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { formatDeckName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import { openDeck, openSection } from "@/lib/sections";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { StudyDeckOption } from "@deephaus/api-client";

type DeckFilter = "all" | "due" | "new";

export default function StudyHubScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [decks, setDecks] = useState<StudyDeckOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
      setLoadFailed(false);
    } catch {
      // Keep any decks already shown; with none, say it failed rather than
      // "No decks yet".
      setLoadFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Refetch on focus so counts are fresh after a session and a first load that
  // raced the initial sync doesn't leave the list empty.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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

  const deckActions = useDeckActions({
    omit: ["study"],
    onRenamed: (deck, name) =>
      setDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, title: name } : d))),
    onDuplicated: () => void load(),
    onDeleted: (deckId) => setDecks((prev) => prev.filter((d) => d.id !== deckId)),
  });

  const filterOptions = useMemo(
    () => [
      { value: "all" as const, label: "All", count: decks.length },
      { value: "due" as const, label: "Due", count: decks.filter((d) => d.due > 0).length },
      { value: "new" as const, label: "New", count: decks.filter((d) => d.new > 0).length },
    ],
    [decks],
  );

  return (
    <>
      <ScreenHeader
        sidebar
        title="Decks"
        search={{
          placeholder: "Search decks",
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={[newCardsAction]}
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        // Virtualised: an imported Anki library can hold hundreds of decks,
        // each row with its own native menu.
        <FlatList
          data={decks.length === 0 ? [] : visibleDecks}
          keyExtractor={(deck) => deck.id}
          renderItem={({ item }) => (
            <View style={styles.rowWrap}>
              <DeckRow deck={item} menu={deckActions.entriesFor(toActionsDeck(item))} />
            </View>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          contentContainerStyle={styles.content}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={searchListKeyboardDismiss}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={colors.accent}
            />
          }
          ListHeaderComponent={
            <View style={styles.listHeader}>
              {Platform.OS !== "ios" ? (
                <Field
                  leadingIcon="search"
                  placeholder="Search decks"
                  value={search}
                  onChangeText={setSearch}
                  returnKeyType="search"
                  containerStyle={styles.searchField}
                />
              ) : null}
              {decks.length > 0 ? (
                <FilterPills
                  accessibilityLabel="Filter decks"
                  options={filterOptions}
                  value={deckFilter}
                  onChange={setDeckFilter}
                />
              ) : null}
              {decks.length > 0 && !hasDue ? (
                <View style={styles.caughtUp}>
                  <UIText variant="subtitle">You're all caught up</UIText>
                  <UIText variant="muted">
                    No cards are due right now. You can still study ahead from a deck below.
                  </UIText>
                </View>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            decks.length === 0 && loadFailed ? (
              <LoadError
                title="Couldn't load your decks"
                onRetry={() => {
                  setLoading(true);
                  void load();
                }}
              />
            ) : decks.length === 0 ? (
              <Card padding={20} style={styles.empty}>
                <FeaturedIcon icon="folder" variant="gray" size="lg" />
                <UIText variant="subtitle" style={styles.emptyTitle}>
                  No decks yet
                </UIText>
                <UIText variant="muted" style={styles.emptyBody}>
                  Make cards from a topic, notes or a link, or subscribe to a community deck.
                </UIText>
                <Button
                  variant="primary"
                  size="md"
                  label="Make cards"
                  onPress={() => openSection("home", { fresh: String(Date.now()) })}
                  style={{ marginTop: 12 }}
                />
              </Card>
            ) : (
              <Card padding={20} style={styles.empty}>
                <FeaturedIcon icon="search" variant="gray" size="lg" />
                <UIText variant="subtitle" style={styles.emptyTitle}>
                  No matching decks
                </UIText>
                <UIText variant="muted" style={styles.emptyBody}>
                  Try a different deck name.
                </UIText>
              </Card>
            )
          }
        />
      )}
      {deckActions.sheets}
    </>
  );
}

function toActionsDeck(deck: StudyDeckOption): DeckActionsDeck {
  return {
    id: deck.id,
    title: deck.title,
    cardCount: deck.due + deck.new + deck.waiting,
    isPublished: deck.is_published,
  };
}

function DeckRow({
  deck,
  menu,
}: {
  deck: StudyDeckOption;
  menu: ReturnType<ReturnType<typeof useDeckActions>["entriesFor"]>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const deckName = formatDeckName(deck.title);
  return (
    <NativeContextMenu label={deck.title} entries={menu}>
      {({ onLongPress }) => (
        <View style={styles.deckRow}>
          <Pressable
            onPress={() => openDeck(deck.id)}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityLabel={`${deck.title}, ${deck.due} due, ${deck.new} new`}
            style={({ pressed }) => [styles.titleCol, pressed && { opacity: 0.6 }]}
          >
            {deckName.path != null && (
              <UIText variant="label" style={styles.deckPath} numberOfLines={1}>
                {deckName.path}
              </UIText>
            )}
            <UIText style={styles.deckTitle} numberOfLines={2}>
              {deckName.title}
            </UIText>
            <View style={styles.deckMeta}>
              {deck.due > 0 && <CountTag color={colors.dueDot} label={`${deck.due} due`} />}
              {deck.new > 0 && <CountTag color={colors.accent} label={`${deck.new} new`} />}
              {deck.due + deck.new === 0 && (
                <CountTag label={deck.waiting > 0 ? `${deck.waiting} waiting` : "Nothing due"} />
              )}
            </View>
          </Pressable>
          <NativeMenu label={`Actions for ${deck.title}`} entries={menu}>
            <View style={styles.moreBtn}>
              <Icon name="more" size={18} color={colors.fgTertiary} />
            </View>
          </NativeMenu>
        </View>
      )}
    </NativeContextMenu>
  );
}

function CountTag({ color, label }: { color?: string; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.countTag}>
      {color ? <View style={[styles.countDot, { backgroundColor: color }]} /> : null}
      <UIText variant="muted">{label}</UIText>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { paddingTop: 8, paddingBottom: 32 },
    listHeader: { gap: 12, paddingBottom: 12 },
    rowWrap: { marginHorizontal: 20 },
    separator: { height: 10 },
    searchField: { marginHorizontal: 20 },
    empty: { alignItems: "center", gap: 4, marginHorizontal: 20 },
    emptyTitle: { marginTop: 12 },
    emptyBody: { textAlign: "center" },
    caughtUp: { gap: 2, paddingBottom: 4, marginHorizontal: 20 },
    deckRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 16,
      paddingRight: 12,
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    titleCol: {
      flex: 1,
      minWidth: 0,
      gap: 3,
      paddingVertical: 13,
    },
    deckTitle: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    deckPath: { fontSize: 11 },
    deckMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      columnGap: 12,
      rowGap: 2,
    },
    countTag: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
    },
    countDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
    },
    moreBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
