import type { BrowseCardRow, BrowseFilters } from "@deephaus/api-client";
import type { Project } from "@deephaus/shared";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
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
import { PageHeader, PageHeaderIconButton } from "@/components/ui/page-header";
import { GlobalSearchSheet } from "@/components/global-search-sheet";
import { RichCardContent } from "@/components/rich-card-content";
import { stripCardMedia } from "@deephaus/shared";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

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
  const [deckPickerOpen, setDeckPickerOpen] = useState(false);
  const [tagPickerOpen, setTagPickerOpen] = useState(false);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [newCardDeckPickerOpen, setNewCardDeckPickerOpen] = useState(false);
  const [newCardTypePickerOpen, setNewCardTypePickerOpen] = useState(false);
  const [newCardDeckId, setNewCardDeckId] = useState<string | null>(null);
  const [creatingCard, setCreatingCard] = useState(false);
  const [searchSheetOpen, setSearchSheetOpen] = useState(false);
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
      ...(filters?.decks ?? []).map((d) => ({ id: d.id, label: d.name })),
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
    await offlineData.browseBatch({ action, card_ids: Array.from(selected) });
    setSelected(new Set());
    await load(0, false);
  }

  async function openNewCard() {
    try {
      const list = projects ?? (await offlineData.listProjects());
      setProjects(list);
      if (list.length === 0) {
        Alert.alert("No decks yet", "Create a deck first, then add cards to it.");
        return;
      }
      setNewCardDeckPickerOpen(true);
    } catch (e) {
      Alert.alert("Could not load decks", e instanceof Error ? e.message : "Unknown error");
    }
  }

  async function createNewCard(type: "basic" | "cloze") {
    if (!newCardDeckId || creatingCard) return;
    setCreatingCard(true);
    try {
      const card = await offlineData.createCard({
        project_id: newCardDeckId,
        type,
        append: true,
      });
      router.push(`/(tabs)/browse/${card.id}`);
    } catch (e) {
      Alert.alert("Could not create card", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCreatingCard(false);
    }
  }

  const newCardDeckOptions = useMemo(
    () =>
      (projects ?? []).map((project) => ({
        id: project.id,
        label: project.deck_name || project.name,
      })),
    [projects],
  );

  return (
    <View style={styles.root}>
      <PageHeader
        title="Browse"
        right={
          <>
            <PageHeaderIconButton
              icon="search"
              label="Search cards"
              onPress={() => setSearchSheetOpen(true)}
            />
            <PageHeaderIconButton
              icon="add"
              label="Create card"
              onPress={() => void openNewCard()}
              disabled={creatingCard}
              loading={creatingCard}
            />
          </>
        }
      />

      <View style={styles.filterRow}>
        <Field
          leadingIcon="search"
          placeholder="Search cards"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => void load(0, false)}
          returnKeyType="search"
          trailing={
            search ? (
              <Pressable onPress={() => setSearch("")} hitSlop={6}>
                <Icon name="close" size={16} color={colors.fgQuaternary} />
              </Pressable>
            ) : null
          }
        />
        <View style={styles.selectGrid}>
          <View style={{ flex: 1 }}>
            <DeckSelect small value={deckLabel} onPress={() => setDeckPickerOpen(true)} />
          </View>
          <View style={{ flex: 1 }}>
            <DeckSelect small value={tagLabel} onPress={() => setTagPickerOpen(true)} />
          </View>
        </View>
      </View>

      {selected.size > 0 && (
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

      <View style={styles.summary}>
        <Text style={styles.summaryText}>{total} cards</Text>
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

      {loading ? (
        <ActivityIndicator color={colors.brand500} style={{ marginTop: 24 }} />
      ) : (
        <FlatList
          data={cards}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
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
              onLongPress={() => toggleSelect(item.id)}
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
                  <Text style={styles.cardBack} numberOfLines={2}>
                    {stripCardMedia(item.back)}
                  </Text>
                )}
                <View style={styles.cardMeta}>
                  <Text style={styles.deckName}>{item.deck_name}</Text>
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
              <Text style={styles.emptyTitle}>No cards found</Text>
              <Text style={styles.emptyBody}>
                Try a different search or remove filters to see all cards.
              </Text>
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
      <DeckSelectModal
        visible={newCardDeckPickerOpen}
        onClose={() => setNewCardDeckPickerOpen(false)}
        title="New card in…"
        options={newCardDeckOptions}
        selectedId={newCardDeckId ?? undefined}
        onSelect={(opt) => {
          setNewCardDeckId(opt.id);
          setNewCardTypePickerOpen(true);
        }}
      />
      <DeckSelectModal
        visible={newCardTypePickerOpen}
        onClose={() => setNewCardTypePickerOpen(false)}
        title="Card type"
        options={[
          { id: "basic", label: "Front / Back" },
          { id: "cloze", label: "Fill-in (cloze)" },
        ]}
        onSelect={(opt) => void createNewCard(opt.id as "basic" | "cloze")}
      />
      <GlobalSearchSheet visible={searchSheetOpen} onClose={() => setSearchSheetOpen(false)} />
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
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 6,
    },
    summaryText: {
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
    cardBack: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      marginTop: 6,
    },
    cardMeta: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      alignItems: "center",
      marginTop: 10,
    },
    deckName: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgQuaternary,
    },
    empty: {
      alignItems: "center",
      marginTop: 16,
      gap: 4,
    },
    emptyTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    emptyBody: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
  });
}
