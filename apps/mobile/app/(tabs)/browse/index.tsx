import type { BrowseCardRow, BrowseFilters } from "@deephaus/api-client";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeckSelect, DeckSelectModal } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { RichCardContent } from "@/components/rich-card-content";
import { stripCardMedia } from "@deephaus/shared";
import { deckDisplayName } from "@/lib/deck-name";
import { haptics } from "@/lib/haptics";
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
    async (nextOffset = 0, append = false) => {
      const requestId = ++requestIdRef.current;
      if (append) {
        setLoadingMore(true);
      } else {
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

  async function batchAction(action: "suspend" | "unsuspend" | "delete") {
    if (selected.size === 0) return;
    if (action === "delete") {
      haptics.warning();
      const count = selected.size;
      const confirmed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          count === 1 ? "Delete card?" : `Delete ${count} cards?`,
          "This can't be undone.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Delete", style: "destructive", onPress: () => resolve(true) },
          ],
        );
      });
      if (!confirmed) return;
    }
    haptics.medium();
    await offlineData.browseBatch({ action, card_ids: Array.from(selected) });
    setSelected(new Set());
    await load(0, false);
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Browse"
        search={{
          placeholder: "Search cards",
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={[
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
        ]}
      />
      {selected.size > 0 && Platform.OS === "ios" ? (
        <Stack.Toolbar placement="bottom">
          <Stack.Toolbar.Button
            icon="pause.circle"
            accessibilityLabel={`Suspend ${selected.size} selected cards`}
            onPress={() => void batchAction("suspend")}
          />
          <Stack.Toolbar.Button
            icon="play.circle"
            accessibilityLabel={`Unsuspend ${selected.size} selected cards`}
            onPress={() => void batchAction("unsuspend")}
          />
          <Stack.Toolbar.Spacer />
          <Stack.Toolbar.Button
            icon="trash"
            tintColor={colors.gradeAgain}
            separateBackground
            accessibilityLabel={`Delete ${selected.size} selected cards`}
            onPress={() => void batchAction("delete")}
          />
        </Stack.Toolbar>
      ) : null}

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

      {selected.size > 0 && Platform.OS !== "ios" && (
        <View style={styles.batchBar}>
          <Text style={styles.batchCount}>{selected.size} selected</Text>
          <View style={{ flexDirection: "row", gap: 6 }}>
            <Button
              variant="secondary"
              size="sm"
              label="Suspend"
              onPress={() => void batchAction("suspend")}
            />
            <Button
              variant="secondary"
              size="sm"
              label="Unsuspend"
              onPress={() => void batchAction("unsuspend")}
            />
            <Button
              variant="danger"
              size="sm"
              label="Delete"
              onPress={() => void batchAction("delete")}
            />
          </View>
        </View>
      )}

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
                {total} cards
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
            <Pressable
              onPress={() => router.push(`/(tabs)/browse/${item.id}`)}
              onLongPress={() => {
                haptics.selection();
                toggleSelect(item.id);
              }}
              accessibilityRole="button"
              accessibilityState={{ selected: selected.has(item.id) }}
              accessibilityHint="Opens the card. Long press to select for bulk actions."
              style={({ pressed }) => [pressed && { opacity: 0.85 }]}
            >
              <Card
                padding={14}
                style={[
                  selected.has(item.id) && styles.selected,
                  item.suspended && styles.suspended,
                ]}
              >
                <RichCardContent
                  content={item.type === "basic" ? item.front ?? "" : item.cloze_text ?? ""}
                  imageHeight={120}
                />
                {item.back && item.type === "basic" && stripCardMedia(item.back) && (
                  <UIText variant="muted" style={styles.cardBack} numberOfLines={2}>
                    {stripCardMedia(item.back)}
                  </UIText>
                )}
                <View style={styles.cardMeta}>
                  <UIText variant="label">{deckDisplayName(item.deck_name)}</UIText>
                  {item.tags.slice(0, 2).map((t) => (
                    <BadgePill key={t} label={t} tone="gray" />
                  ))}
                  {item.suspended && <BadgePill label="Suspended" tone="gray" />}
                </View>
              </Card>
            </Pressable>
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
    batchBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    batchCount: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgSecondary,
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
    selected: {
      borderColor: colors.brand500,
      backgroundColor: colors.brand25,
    },
    suspended: {
      opacity: 0.6,
    },
    cardText: {
      fontSize: 14,
      lineHeight: 20,
      color: colors.fgPrimary,
    },
    cardBack: { marginTop: 6 },
    cardMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      alignItems: "center",
      marginTop: 10,
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
