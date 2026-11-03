import type { BrowseCardRow, BrowseFilters } from "@deephaus/api-client";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Card } from "@/components/ui/card";
import { DeckSelect, DeckSelectModal } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { deckDisplayName } from "@/lib/deck-name";
import { useHeaderInset } from "@/lib/header-inset";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export default function BrowseScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const headerInset = useHeaderInset();
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
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
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
        if (result.filters) setFilters(result.filters);
      } catch {
        if (requestId === requestIdRef.current && !append) setCards([]);
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

  // Edits, deletes and new cards from other screens show up on return. Native
  // tabs mount every tab at launch, so even the first focus can be stale.
  useFocusEffect(
    useCallback(() => {
      void load(0, false, true);
    }, [load]),
  );

  const deckOptions = useMemo(
    () => [
      { id: "__all__", label: "All decks" },
      ...(filters?.decks ?? []).map((d) => ({ id: d.id, label: deckDisplayName(d.name) })),
    ],
    [filters],
  );
  const tagOptions = useMemo(
    () => [
      { id: "__all__", label: "All tags" },
      ...(filters?.tags ?? []).map((t) => ({ id: t, label: t })),
    ],
    [filters],
  );

  const deckLabel =
    deckOptions.find((d) => d.id === (deckId ?? "__all__"))?.label ?? "All decks";
  const tagLabel = tag ?? "All tags";

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function batchAction(action: CardBatchAction) {
    if (!(await runCardBatchAction(action, Array.from(selected)))) return;
    setSelected(new Set());
    await load(0, false);
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title={selected.size > 0 ? `${selected.size} selected` : "Browse"}
        search={{
          placeholder: "Search cards",
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={
          selected.size > 0
            ? cardSelectionHeaderActions(
                selected.size,
                (action) => void batchAction(action),
                () => setSelected(new Set()),
              )
            : [
                {
                  type: "menu",
                  icon: "filter",
                  sfIcon: "line.3.horizontal.decrease",
                  label: "Filter cards",
                  items: [
                    {
                      label: deckId ? `Deck: ${deckLabel}` : "Filter by deck…",
                      sfIcon: "folder",
                      selected: Boolean(deckId),
                      onPress: () => setDeckPickerOpen(true),
                    },
                    {
                      label: tag ? `Tag: ${tagLabel}` : "Filter by tag…",
                      sfIcon: "tag",
                      selected: Boolean(tag),
                      onPress: () => setTagPickerOpen(true),
                    },
                    {
                      label: "Clear filters",
                      sfIcon: "xmark.circle",
                      disabled: !deckId && !tag,
                      onPress: () => {
                        setDeckId(undefined);
                        setTag(undefined);
                      },
                    },
                  ],
                },
              ]
        }
      />
      <View style={styles.filterRow}>
        {Platform.OS !== "ios" ? (
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
        ) : null}
        {Platform.OS !== "ios" ? (
          <View style={styles.selectGrid}>
            <View style={{ flex: 1 }}>
              <DeckSelect small value={deckLabel} onPress={() => setDeckPickerOpen(true)} />
            </View>
            <View style={{ flex: 1 }}>
              <DeckSelect small value={tagLabel} onPress={() => setTagPickerOpen(true)} />
            </View>
          </View>
        ) : null}
      </View>

      <CardBatchToolbar count={selected.size} onAction={(action) => void batchAction(action)} />

      {loading ? (
        <ActivityIndicator
          color={colors.brand500}
          style={{ marginTop: headerInset + 24 }}
        />
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={
            <View style={styles.summary}>
              <Text style={styles.summaryText} numberOfLines={1}>
                {total} card{total === 1 ? "" : "s"}
                {deckId ? ` · ${deckLabel}` : ""}
                {tag ? ` · #${tagLabel}` : ""}
              </Text>
              {(deckId || tag || search) && (
                <Pressable
                  onPress={() => {
                    setDeckId(undefined);
                    setTag(undefined);
                    setSearch("");
                  }}
                  hitSlop={6}
                >
                  <Text style={styles.clearText}>Clear filters</Text>
                </Pressable>
              )}
            </View>
          }
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(0, false).finally(() => setRefreshing(false));
              }}
              tintColor={colors.brand500}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          onEndReachedThreshold={0.3}
          onEndReached={() => {
            if (loading || loadingMore || cards.length >= total) return;
            void load(cards.length, true);
          }}
          ListFooterComponent={
            loadingMore ? (
              <ActivityIndicator color={colors.brand500} style={{ marginVertical: 16 }} />
            ) : null
          }
          renderItem={({ item }) => (
            <CardListItem
              card={item}
              selected={selected.has(item.id)}
              onPress={() => router.push(`/(tabs)/browse/${item.id}`)}
              onLongPress={() => toggleSelect(item.id)}
            />
          )}
          ListEmptyComponent={
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="folder" variant="gray" size="lg" />
              <UIText variant="subtitle" style={styles.emptyTitle}>
                No cards found
              </UIText>
              <UIText variant="muted" style={styles.emptyBody}>
                Try a different search or remove filters to see all cards.
              </UIText>
            </Card>
          }
        />
      )}

      <DeckSelectModal
        visible={deckPickerOpen}
        onClose={() => setDeckPickerOpen(false)}
        title="Filter by deck"
        options={deckOptions}
        selectedId={deckId ?? "__all__"}
        onSelect={(opt) => setDeckId(opt.id === "__all__" ? undefined : opt.id)}
      />
      <DeckSelectModal
        visible={tagPickerOpen}
        onClose={() => setTagPickerOpen(false)}
        title="Filter by tag"
        options={tagOptions}
        selectedId={tag ?? "__all__"}
        onSelect={(opt) => setTag(opt.id === "__all__" ? undefined : opt.id)}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    filterRow: {
      paddingHorizontal: 16,
      paddingTop: 12,
      gap: 10,
    },
    selectGrid: {
      flexDirection: "row",
      gap: 8,
    },
    summary: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 4,
      paddingTop: 16,
      paddingBottom: 10,
    },
    summaryText: {
      flexShrink: 1,
      marginRight: 8,
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    clearText: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.brand600,
    },
    listContent: {
      paddingHorizontal: 16,
      paddingBottom: 32,
    },
    empty: {
      alignItems: "center",
      marginTop: 16,
      gap: 4,
    },
    emptyTitle: { marginTop: 12 },
    emptyBody: { textAlign: "center" },
  });
}
