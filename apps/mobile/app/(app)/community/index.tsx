import type { CommunityDeckRow } from "@deephaus/api-client";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { Button } from "@/components/ui/button";
import { CommunityDeckRelationBadge } from "@/components/ui/community-deck-relation-badge";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterPills } from "@/components/ui/filter-pills";
import { Field } from "@/components/ui/input";
import { communityDeckLogoKind, DeckLogo } from "@/components/ui/deck-logo";
import { Icon } from "@/components/ui/icon";
import {
  newCardsAction,
  ScreenHeader,
  searchListKeyboardDismiss,
  type ScreenHeaderMenuAction,
} from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { OfflineNotice } from "@/components/offline-notice";
import { api } from "@/lib/api";
import { showActionSheet } from "@/lib/action-sheet";
import { haptics } from "@/lib/haptics";
import { useOnline } from "@/lib/use-online";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type SortMode = "name-asc" | "popular" | "newest" | "rating";

const SORT_OPTIONS: Array<{ value: SortMode; label: string; sfIcon: string }> = [
  { value: "name-asc", label: "Name (A–Z)", sfIcon: "textformat.abc" },
  { value: "popular", label: "Popular", sfIcon: "person.2" },
  { value: "newest", label: "Newest", sfIcon: "clock" },
  { value: "rating", label: "Top rated", sfIcon: "star" },
];

function formatRating(avg: number | undefined, count: number | undefined): string {
  if (!count) return "No ratings";
  return `${(avg ?? 0).toFixed(1)} (${count})`;
}

export default function CommunityScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ q?: string }>();
  const [decks, setDecks] = useState<CommunityDeckRow[]>([]);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");

  // Deep links from global search prefill the community search box.
  useEffect(() => {
    if (typeof params.q === "string" && params.q) {
      setSearch(params.q);
      router.setParams({ q: undefined });
    }
  }, [params.q]);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const online = useOnline();
  const requestIdRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!online) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const result = await api.listCommunityDecks(debouncedSearch || undefined);
      if (requestId === requestIdRef.current) setDecks(result.decks);
    } catch {
      if (requestId === requestIdRef.current) setDecks([]);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [debouncedSearch, online]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function openPreview(id: string) {
    router.push(`/community/${id}`);
  }

  const sortedDecks = useMemo(() => {
    const copy = [...decks];
    if (sortMode === "newest") {
      copy.sort(
        (a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime(),
      );
    } else if (sortMode === "rating") {
      copy.sort(
        (a, b) =>
          (b.avg_rating ?? 0) - (a.avg_rating ?? 0) ||
          (b.rating_count ?? 0) - (a.rating_count ?? 0),
      );
    } else if (sortMode === "name-asc") {
      copy.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: "base" }));
    } else {
      copy.sort((a, b) => b.subscriber_count - a.subscriber_count);
    }
    return copy;
  }, [decks, sortMode]);

  /** One-tap subscribe from the list: pick Follow or Fork without the preview detour. */
  function quickSubscribe(item: CommunityDeckRow) {
    showActionSheet(item.title, "How do you want to add this deck?", [
      {
        label: "Follow (sync updates)",
        onPress: () => void quickSubscribeConfirm(item.id, "follow"),
      },
      {
        label: "Fork (static copy)",
        onPress: () => void quickSubscribeConfirm(item.id, "fork"),
      },
    ]);
  }

  async function quickSubscribeConfirm(publicationId: string, syncMode: "follow" | "fork") {
    setBusy(true);
    try {
      const { localProjectId } = await api.subscribeCommunityDeck(publicationId, syncMode);
      haptics.success();
      router.push(`/study/${localProjectId}`);
      await load();
    } catch (e) {
      Alert.alert("Subscribe failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  async function unsubscribe(publicationId: string) {
    try {
      await api.unsubscribeCommunityDeck(publicationId);
      await load();
    } catch (e) {
      Alert.alert("Unsubscribe failed", e instanceof Error ? e.message : "Unknown error");
    }
  }

  return (
    <>
      <ScreenHeader
        sidebar
        title="Community"
        search={{
          placeholder: "Search community decks",
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={[
          {
            type: "menu",
            icon: "filter",
            sfIcon: "line.3.horizontal.decrease",
            label: "Sort decks",
            items: SORT_OPTIONS.map((option) => ({
              label: option.label,
              sfIcon: option.sfIcon as ScreenHeaderMenuAction["sfIcon"],
              selected: sortMode === option.value,
              onPress: () => {
                haptics.selection();
                setSortMode(option.value);
              },
            })),
          },
          newCardsAction,
        ]}
      />

      {Platform.OS !== "ios" ? (
        <View style={styles.androidControls}>
          <View style={styles.searchRow}>
            <Field
              leadingIcon="search"
              placeholder="Search decks"
              value={search}
              onChangeText={setSearch}
              onSubmitEditing={() => void load()}
              returnKeyType="search"
            />
          </View>
          <FilterPills
            options={SORT_OPTIONS}
            value={sortMode}
            onChange={setSortMode}
            accessibilityLabel="Sort decks"
          />
        </View>
      ) : null}

      {/* Stays mounted while loading so the large title keeps tracking its scroller. */}
      <FlatList
        data={sortedDecks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={searchListKeyboardDismiss}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load().finally(() => setRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          !online ? (
            <OfflineNotice feature="Community decks" />
          ) : loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : (
            <View style={styles.empty}>
              <FeaturedIcon icon="community" variant="gray" size="lg" />
              <UIText variant="subtitle" style={styles.emptyTitle}>
                No community decks yet
              </UIText>
              <UIText variant="muted" style={styles.emptyBody}>
                Be the first to publish a deck for others to study.
              </UIText>
            </View>
          )
        }
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Preview ${item.title}`}
              onPress={() => openPreview(item.id)}
              style={({ pressed }) => [styles.rowMain, pressed && styles.rowPressed]}
            >
              <DeckLogo kind={communityDeckLogoKind(item)} />
              <View style={styles.rowText}>
                <View style={styles.titleLine}>
                  <UIText style={styles.title} numberOfLines={2}>
                    {item.title}
                  </UIText>
                  <UIText variant="muted">
                    {`${item.card_count} card${item.card_count === 1 ? "" : "s"}`}
                  </UIText>
                </View>
                {item.description ? (
                  <UIText variant="muted" numberOfLines={2}>
                    {item.description}
                  </UIText>
                ) : null}
                <View style={styles.meta}>
                  <UIText variant="muted">{`${item.subscriber_count} subs ·`}</UIText>
                  <View style={styles.rating}>
                    <Icon name="star" size={12} color={colors.fgTertiary} />
                    <UIText variant="muted">
                      {formatRating(item.avg_rating, item.rating_count)}
                    </UIText>
                  </View>
                  {item.is_owner || item.is_subscribed ? (
                    <CommunityDeckRelationBadge deck={item} />
                  ) : null}
                </View>
              </View>
            </Pressable>
            {item.is_owner ? null : item.is_subscribed ? (
              <Button
                variant="secondary"
                label="Unsubscribe"
                onPress={() => void unsubscribe(item.id)}
                fullWidth
              />
            ) : (
              <Button
                variant="secondary"
                label="Subscribe"
                disabled={busy}
                onPress={() => quickSubscribe(item)}
                fullWidth
              />
            )}
          </View>
        )}
      />
    </>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    androidControls: { paddingTop: 12, gap: 10 },
    searchRow: { paddingHorizontal: 20 },
    list: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 32,
      gap: 10,
    },
    empty: { alignItems: "center", gap: 4, paddingVertical: 32 },
    emptyTitle: { marginTop: 12, textAlign: "center" },
    emptyBody: { textAlign: "center" },
    row: {
      gap: 12,
      padding: 14,
      borderRadius: radius.xl3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    rowMain: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
    },
    rowPressed: { opacity: 0.6 },
    rowText: { flex: 1, minWidth: 0, gap: 2 },
    titleLine: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
    title: {
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    meta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 6,
      rowGap: 4,
      marginTop: 2,
    },
    rating: { flexDirection: "row", alignItems: "center", gap: 3 },
  });
}
