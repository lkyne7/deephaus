import type { BrowseCardRow, BrowseFilters } from "@deephaus/api-client";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  CardBatchToolbar,
  cardSelectionHeaderActions,
  runCardBatchAction,
  type CardBatchAction,
} from "@/components/card-batch-toolbar";
import { CardListItem } from "@/components/card-list-item";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterMenuPill, FilterPills } from "@/components/ui/filter-pills";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import { NativeLinkMenu } from "@/components/ui/native-menu";
import {
  newCardsAction,
  ScreenHeader,
  searchListKeyboardDismiss,
} from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { LoadError } from "@/components/load-error";
import { deckDisplayName, formatDeckName } from "@/lib/deck-name";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

function openCard(id: string) {
  router.push(`/cards/${id}`);
}

/** Memoized so toggling one row's selection doesn't rebuild every row's menu. */
const CardRow = memo(function CardRow({
  card,
  selected,
  selecting,
  onToggle,
  onAction,
}: {
  card: BrowseCardRow;
  selected: boolean;
  selecting: boolean;
  onToggle: (id: string) => void;
  onAction: (action: CardBatchAction, id: string) => void;
}) {
  const entries = useMemo<NativeMenuEntry[]>(
    () => [
      {
        items: [
          { label: "Open", sfIcon: "doc.text", onPress: () => openCard(card.id) },
          {
            label: selected ? "Deselect" : "Select",
            sfIcon: selected ? "xmark.circle" : "checkmark.circle",
            onPress: () => onToggle(card.id),
          },
          card.suspended
            ? {
                label: "Unsuspend",
                sfIcon: "play.circle",
                onPress: () => onAction("unsuspend", card.id),
              }
            : {
                label: "Suspend",
                sfIcon: "pause.circle",
                onPress: () => onAction("suspend", card.id),
              },
        ],
      },
      {
        items: [
          {
            label: "Delete",
            sfIcon: "trash",
            destructive: true,
            onPress: () => onAction("delete", card.id),
          },
        ],
      },
    ],
    [card.id, card.suspended, selected, onToggle, onAction],
  );
  return (
    <NativeLinkMenu
      href={`/cards/${card.id}`}
      label="Card"
      entries={entries}
      onPress={(event) => {
        if (!selecting) return;
        event.preventDefault();
        onToggle(card.id);
      }}
    >
      <CardListItem card={card} selected={selected} selecting={selecting} />
    </NativeLinkMenu>
  );
});

export default function BrowseScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ deck?: string }>();
  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [filters, setFilters] = useState<BrowseFilters | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [deckId, setDeckId] = useState<string | undefined>();
  const [tag, setTag] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  // `total` follows the filters, but the All pill always counts the whole library.
  const [libraryTotal, setLibraryTotal] = useState<number | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const requestIdRef = useRef(0);

  // Deep links from global search preselect a deck filter.
  useEffect(() => {
    if (typeof params.deck === "string" && params.deck) {
      setDeckId(params.deck);
      router.setParams({ deck: undefined });
    }
  }, [params.deck]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(
    async (nextOffset = 0, append = false, silent = false) => {
      const requestId = ++requestIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else if (!silent) {
        setLoading(true);
      }
      try {
        const result = await offlineData.browseCards({
          deck_id: deckId,
          tag,
          q: debouncedSearch || undefined,
          limit: 50,
          offset: nextOffset,
          filters: nextOffset === 0,
        });
        if (requestId !== requestIdRef.current) return;
        setCards((prev) => {
          if (!append) return result.cards;
          const existing = new Set(prev.map((card) => card.id));
          return [...prev, ...result.cards.filter((card) => !existing.has(card.id))];
        });
        setTotal(result.total);
        if (!deckId && !tag && !debouncedSearch) setLibraryTotal(result.total);
        if (result.filters) setFilters(result.filters);
        setLoadFailed(false);
      } catch {
        // Keep what's shown; with nothing, say it failed rather than "No cards found".
        if (requestId === requestIdRef.current && !append) setLoadFailed(true);
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [deckId, tag, debouncedSearch],
  );

  useEffect(() => {
    void load(0, false);
  }, [load]);

  // Edits, deletes and new cards from other screens show up on return. The
  // effect above covers the first load and filter changes, so this only runs
  // when the screen is shown again.
  const loadRef = useRef(load);
  loadRef.current = load;
  const focusedOnceRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (focusedOnceRef.current) void loadRef.current(0, false, true);
      focusedOnceRef.current = true;
    }, []),
  );

  const deckEntries = useMemo<NativeMenuEntry[]>(
    () => [
      { label: "All decks", selected: !deckId, onPress: () => setDeckId(undefined) },
      {
        items: (filters?.decks ?? []).map((deck) => ({
          label: deckDisplayName(deck.name),
          selected: deck.id === deckId,
          onPress: () => setDeckId(deck.id),
        })),
      },
    ],
    [filters, deckId],
  );
  const tagEntries = useMemo<NativeMenuEntry[]>(
    () => [
      { label: "All tags", selected: !tag, onPress: () => setTag(undefined) },
      {
        items: (filters?.tags ?? []).map((name) => ({
          label: name,
          selected: name === tag,
          onPress: () => setTag(name),
        })),
      },
    ],
    [filters, tag],
  );

  const activeDeck = filters?.decks.find((deck) => deck.id === deckId);
  const selecting = selected.size > 0;

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cardAction = useCallback(
    async (action: CardBatchAction, id: string) => {
      if (!(await runCardBatchAction(action, [id]))) return;
      if (action === "delete") {
        setSelected((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
      await load(0, false, true);
    },
    [load],
  );

  const renderCard = useCallback(
    ({ item }: { item: BrowseCardRow }) => (
      <CardRow
        card={item}
        selected={selected.has(item.id)}
        selecting={selecting}
        onToggle={toggleSelect}
        onAction={cardAction}
      />
    ),
    [selected, selecting, toggleSelect, cardAction],
  );

  async function batchAction(action: CardBatchAction) {
    if (!(await runCardBatchAction(action, Array.from(selected)))) return;
    setSelected(new Set());
    await load(0, false);
  }

  return (
    <>
      <ScreenHeader
        sidebar
        title={selecting ? `${selected.size} selected` : "Cards"}
        search={{
          placeholder: "Search cards",
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={
          selecting
            ? cardSelectionHeaderActions(
                selected.size,
                (action) => void batchAction(action),
                () => setSelected(new Set()),
              )
            : [newCardsAction]
        }
      />
      {Platform.OS !== "ios" ? (
        <View style={styles.searchRow}>
          <Field
            leadingIcon="search"
            placeholder="Search cards"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => void load(0, false)}
            returnKeyType="search"
            trailing={
              search ? (
                <Pressable
                  onPress={() => setSearch("")}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                >
                  <Icon name="close" size={16} color={colors.fgQuaternary} />
                </Pressable>
              ) : null
            }
          />
        </View>
      ) : null}

      <CardBatchToolbar count={selected.size} onAction={(action) => void batchAction(action)} />

      {/* Stays mounted while loading so the large title keeps tracking its scroller. */}
      <FlatList
        data={loading ? [] : cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        contentInsetAdjustmentBehavior="automatic"
        // Every row hosts a system context menu, so keep fewer of them mounted.
        windowSize={9}
        ListHeaderComponent={
          <View style={styles.listHeader}>
            <FilterPills
              options={[{ value: "all", label: "All", count: libraryTotal }]}
              value={deckId || tag ? null : "all"}
              onChange={() => {
                setDeckId(undefined);
                setTag(undefined);
              }}
              accessibilityLabel="Filter cards"
              trailing={
                <>
                  <FilterMenuPill
                    label={activeDeck ? formatDeckName(activeDeck.name).title : "Deck"}
                    active={Boolean(deckId)}
                    entries={deckEntries}
                  />
                  <FilterMenuPill
                    label={tag ?? "Tag"}
                    active={Boolean(tag)}
                    entries={tagEntries}
                  />
                </>
              }
            />
            {deckId || tag || search ? (
              <View style={styles.summary}>
                <Text style={styles.summaryText} numberOfLines={1}>
                  {total} card{total === 1 ? "" : "s"}
                </Text>
                <Pressable
                  onPress={() => {
                    setDeckId(undefined);
                    setTag(undefined);
                    setSearch("");
                  }}
                  hitSlop={6}
                  accessibilityRole="button"
                >
                  <Text style={styles.clearText}>Clear filters</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        }
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={searchListKeyboardDismiss}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(0, false).finally(() => setRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
        onEndReachedThreshold={0.3}
        onEndReached={() => {
          if (loading || loadingMore || cards.length >= total) return;
          void load(cards.length, true);
        }}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : null
        }
        renderItem={renderCard}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : loadFailed ? (
            <LoadError title="Couldn't load your cards" onRetry={() => void load(0, false)} />
          ) : (
            <View style={styles.empty}>
              <FeaturedIcon icon="folder" variant="gray" size="lg" />
              <UIText variant="subtitle" style={styles.emptyTitle}>
                No cards found
              </UIText>
              <UIText variant="muted" style={styles.emptyBody}>
                Try a different search or remove filters to see all cards.
              </UIText>
            </View>
          )
        }
      />
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    searchRow: { paddingHorizontal: 20, paddingTop: 12 },
    listHeader: { paddingTop: 8, paddingBottom: 6, gap: 8 },
    summary: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 20,
    },
    summaryText: {
      flexShrink: 1,
      marginRight: 8,
      fontSize: 13,
      color: colors.fgTertiary,
    },
    clearText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.accentInk,
    },
    listContent: { paddingBottom: 32 },
    empty: {
      alignItems: "center",
      paddingTop: 56,
      paddingHorizontal: 20,
      gap: 4,
    },
    emptyTitle: { marginTop: 12 },
    emptyBody: { textAlign: "center" },
  });
}
