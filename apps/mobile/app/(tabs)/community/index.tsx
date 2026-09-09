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
  Text,
  View,
} from "react-native";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { CommunityDeckRelationBadge } from "@/components/ui/community-deck-relation-badge";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { communityDeckLogoKind, DeckLogo } from "@/components/ui/deck-logo";
import {
  ScreenHeader,
  type ScreenHeaderMenuAction,
} from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { OfflineNotice } from "@/components/offline-notice";
import { api } from "@/lib/api";
import { showActionSheet } from "@/lib/action-sheet";
import { haptics } from "@/lib/haptics";
import { useHeaderInset } from "@/lib/header-inset";
import { useOnline } from "@/lib/use-online";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type SortMode = "name-asc" | "popular" | "newest" | "rating";

const SORT_OPTIONS: Array<{ id: SortMode; label: string; sfIcon: string }> = [
  { id: "name-asc", label: "Name (A–Z)", sfIcon: "textformat.abc" },
  { id: "popular", label: "Popular", sfIcon: "person.2" },
  { id: "newest", label: "Newest", sfIcon: "clock" },
  { id: "rating", label: "Top rated", sfIcon: "star" },
];

function formatRating(avg: number | undefined, count: number | undefined): string {
  if (!count) return "No ratings";
  return `${(avg ?? 0).toFixed(1)} (${count})`;
}

export default function CommunityScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const headerInset = useHeaderInset();
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
    router.push(`/(tabs)/community/${id}`);
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
      router.push(`/(tabs)/study/${localProjectId}`);
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
    <View style={styles.root}>
      <ScreenHeader
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
              selected: sortMode === option.id,
              onPress: () => {
                haptics.selection();
                setSortMode(option.id);
              },
            })),
          },
        ]}
      />

      {Platform.OS !== "ios" ? (
        <View style={styles.searchRow}>
          <Field
            leadingIcon="search"
            placeholder="Search decks"
            value={search}
            onChangeText={setSearch}
            onSubmitEditing={() => void load()}
            returnKeyType="search"
          />
        <View style={styles.sortRow}>
          {SORT_OPTIONS.map((opt) => {
            const active = sortMode === opt.id;
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => {
                  haptics.selection();
                  setSortMode(opt.id);
                }}
                style={[styles.sortChip, active && styles.sortChipActive]}
              >
                <Text style={[styles.sortChipLabel, active && styles.sortChipLabelActive]}>
                  {opt.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        </View>
      ) : null}

      {!online && decks.length === 0 ? (
        <View style={{ paddingTop: headerInset }}>
          <OfflineNotice feature="Community decks" />
        </View>
      ) : loading ? (
        <ActivityIndicator
          color={colors.brand500}
          style={{ marginTop: headerInset + 24 }}
        />
      ) : (
        <FlatList
          data={sortedDecks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load().finally(() => setRefreshing(false));
              }}
              tintColor={colors.brand500}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
          ListEmptyComponent={
            <Card padding={20} style={styles.empty}>
              <FeaturedIcon icon="community" variant="brand" size="lg" />
              <UIText variant="subtitle" style={styles.emptyTitle}>
                No community decks yet
              </UIText>
              <UIText variant="muted" style={styles.emptyBody}>
                Be the first to publish a deck for others to study.
              </UIText>
            </Card>
          }
          renderItem={({ item }) => (
            <Card padding={16}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Preview ${item.title}`}
                onPress={() => openPreview(item.id)}
                style={({ pressed }) => [pressed && { opacity: 0.85 }]}
              >
                <View style={styles.titleRow}>
                  <DeckLogo kind={communityDeckLogoKind(item)} />
                  <UIText variant="subtitle" style={styles.title}>
                    {item.title}
                  </UIText>
                </View>
                {item.description ? (
                  <UIText variant="muted" style={styles.desc}>
                    {item.description}
                  </UIText>
                ) : null}
                <View style={styles.badges}>
                  <BadgePill icon="layers" label={`${item.card_count} cards`} tone="gray" />
                  <BadgePill icon="user" label={`${item.subscriber_count} subs`} tone="gray" />
                  <BadgePill
                    icon="star"
                    label={formatRating(item.avg_rating, item.rating_count)}
                    tone="gray"
                  />
                  <CommunityDeckRelationBadge deck={item} />
                </View>
              </Pressable>
              <View style={styles.actions}>
                {item.is_owner ? (
                  <Button
                    variant="secondary"
                    size="md"
                    label="Preview"
                    onPress={() => openPreview(item.id)}
                    style={{ flex: 1 }}
                  />
                ) : item.is_subscribed ? (
                  <Button
                    variant="secondary"
                    size="md"
                    label="Unsubscribe"
                    onPress={() => void unsubscribe(item.id)}
                    style={{ flex: 1 }}
                  />
                ) : (
                  <>
                    <Button
                      variant="secondary"
                      size="md"
                      label="Preview"
                      onPress={() => openPreview(item.id)}
                      style={{ flex: 1 }}
                    />
                    <Button
                      variant="brand"
                      size="md"
                      label="Subscribe"
                      leadingIcon="add"
                      disabled={busy}
                      onPress={() => quickSubscribe(item)}
                      style={{ flex: 1 }}
                    />
                  </>
                )}
              </View>
            </Card>
          )}
        />
      )}

    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    searchRow: { paddingHorizontal: 16, paddingTop: 12, gap: 10 },
    sortRow: { flexDirection: "row", gap: 8 },
    sortChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      backgroundColor: colors.bgSurface,
    },
    sortChipActive: {
      borderColor: colors.brand500,
      backgroundColor: colors.brand50,
    },
    sortChipLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    sortChipLabelActive: { color: colors.brand700 },
    ratingRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginTop: 4,
    },
    ratingLabel: { fontSize: 13, fontWeight: "500", color: colors.fgTertiary },
    ratingClear: { fontSize: 13, fontWeight: "500", color: colors.brand600 },
    list: {
      padding: 16,
      paddingTop: 16,
      paddingBottom: 32,
    },
    empty: { alignItems: "center", gap: 4, marginTop: 8 },
    emptyTitle: { marginTop: 12 },
    emptyBody: { textAlign: "center" },
    titleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
    title: { flex: 1 },
    desc: { marginBottom: 12 },
    badges: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 14,
    },
    actions: { flexDirection: "row", gap: 8 },
    previewDesc: { fontSize: 14, lineHeight: 20 },
    previewSection: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgQuaternary,
      letterSpacing: 0,
      paddingHorizontal: 4,
    },
    previewList: { padding: 16, gap: 8 },
    previewFooter: {
      padding: 16,
      backgroundColor: colors.bgSurface,
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
      gap: 10,
    },
  });
}
