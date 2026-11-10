import type { CommunityDeckRow } from "@deephaus/api-client";
import {
  COMMUNITY_SORT_OPTIONS,
  COMMUNITY_SUBJECTS,
  DEFAULT_COMMUNITY_SORT,
  countLabel,
  learnerLabel,
  visibleCommunityDecks,
  type CommunitySort,
} from "@deephaus/shared";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { LoadError } from "@/components/load-error";
import { OfflineNotice } from "@/components/offline-notice";
import { CommunityDeckRelationBadge } from "@/components/ui/community-deck-relation-badge";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterPills } from "@/components/ui/filter-pills";
import { Icon } from "@/components/ui/icon";
import { Field } from "@/components/ui/input";
import {
  newCardsAction,
  ScreenHeader,
  searchListKeyboardDismiss,
  type ScreenHeaderMenuAction,
} from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

const SORT_ICONS: Record<CommunitySort, ScreenHeaderMenuAction["sfIcon"]> = {
  subscribers: "person.2",
  rating: "star",
  newest: "clock",
};

const SEARCH_PLACEHOLDER = "Decks or authors";

export default function CommunityScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const params = useLocalSearchParams<{ q?: string }>();
  const [decks, setDecks] = useState<CommunityDeckRow[]>([]);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<CommunitySort>(DEFAULT_COMMUNITY_SORT);
  const [subject, setSubject] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const online = useOnline();
  const requestIdRef = useRef(0);

  // Deep links from global search prefill the community search box.
  useEffect(() => {
    if (typeof params.q === "string" && params.q) {
      setSearch(params.q);
      router.setParams({ q: undefined });
    }
  }, [params.q]);

  // The whole list comes down once; searching, subjects and sorting happen here,
  // so the search can match authors and descriptions as well as titles.
  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (!online) {
      setLoading(false);
      return;
    }
    try {
      const result = await api.listCommunityDecks();
      if (requestId === requestIdRef.current) {
        setDecks(result.decks);
        setLoadFailed(false);
      }
    } catch {
      // Keep what's shown; with nothing, say it failed rather than "be the first".
      if (requestId === requestIdRef.current) setLoadFailed(true);
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [online]);

  // Refetch on focus: a deck added from its page should read "In your decks" on return.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Only subjects that have a deck get a chip.
  const subjectOptions = useMemo(() => {
    const used = COMMUNITY_SUBJECTS.filter((option) =>
      decks.some((deck) => deck.subject === option.value),
    );
    return used.length === 0
      ? []
      : [{ value: "", label: "All" }, ...used.map((option) => ({ value: option.value, label: option.label }))];
  }, [decks]);
  const activeSubject = subjectOptions.some((option) => option.value === subject) ? subject : "";

  const visible = useMemo(
    () => visibleCommunityDecks(decks, { query: search, sort, subject: activeSubject || undefined }),
    [decks, search, sort, activeSubject],
  );
  const filtering = search.trim().length > 0 || activeSubject !== "";

  return (
    <>
      <ScreenHeader
        sidebar
        title="Community"
        search={{
          placeholder: SEARCH_PLACEHOLDER,
          onChangeText: setSearch,
          onCancel: () => setSearch(""),
        }}
        actions={[
          {
            type: "menu",
            icon: "filter",
            sfIcon: "arrow.up.arrow.down",
            label: "Sort decks",
            items: COMMUNITY_SORT_OPTIONS.map((option) => ({
              label: option.label,
              sfIcon: SORT_ICONS[option.value],
              selected: sort === option.value,
              onPress: () => {
                haptics.selection();
                setSort(option.value);
              },
            })),
          },
          newCardsAction,
        ]}
      />

      {Platform.OS !== "ios" ? (
        <View style={styles.androidControls}>
          <Field
            leadingIcon="search"
            placeholder={SEARCH_PLACEHOLDER}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
          />
        </View>
      ) : null}

      {/* Stays mounted while loading so the large title keeps tracking its scroller. */}
      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode={searchListKeyboardDismiss}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
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
        ListHeaderComponent={
          subjectOptions.length > 0 ? (
            <FilterPills
              accessibilityLabel="Subject"
              options={subjectOptions}
              value={activeSubject}
              onChange={setSubject}
              style={styles.subjects}
            />
          ) : null
        }
        ListEmptyComponent={
          !online ? (
            <OfflineNotice feature="Community decks" />
          ) : loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : loadFailed ? (
            <LoadError title="Couldn't load community decks" onRetry={() => void load()} />
          ) : (
            <View style={styles.empty}>
              <FeaturedIcon icon={filtering ? "search" : "community"} variant="gray" size="lg" />
              <UIText variant="subtitle" style={styles.emptyTitle}>
                {filtering ? "No decks match" : "No community decks yet"}
              </UIText>
              <UIText variant="muted" style={styles.emptyBody}>
                {filtering
                  ? "Try another search or subject."
                  : "Publish one of your decks from its page to share it here."}
              </UIText>
            </View>
          )
        }
        renderItem={({ item }) => <CommunityRow deck={item} />}
      />
    </>
  );
}

/** "268 cards · 2,210 learners · @daniel" */
function metaLine(deck: CommunityDeckRow): string {
  return [
    countLabel(deck.card_count, "card"),
    learnerLabel(deck.subscriber_count),
    deck.author ? `@${deck.author}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function CommunityRow({ deck }: { deck: CommunityDeckRow }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const rated = (deck.rating_count ?? 0) > 0;
  const rating = rated ? (deck.avg_rating ?? 0).toFixed(1) : "New";
  const mine = deck.is_owner || deck.is_subscribed;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[
        deck.title,
        deck.description,
        metaLine(deck),
        rated ? `rated ${rating} of 5` : "no ratings yet",
        deck.is_owner ? "yours" : deck.is_subscribed ? "in your decks" : null,
      ]
        .filter(Boolean)
        .join(", ")}
      onPress={() => router.push(`/community/${deck.id}`)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowText}>
        <UIText style={styles.title} numberOfLines={2}>
          {deck.title}
        </UIText>
        {deck.description?.trim() ? (
          <UIText variant="muted" numberOfLines={2}>
            {deck.description.trim()}
          </UIText>
        ) : null}
        <View style={styles.meta}>
          {mine ? <CommunityDeckRelationBadge deck={deck} /> : null}
          <UIText variant="muted" style={styles.metaText} numberOfLines={1}>
            {metaLine(deck)}
          </UIText>
        </View>
      </View>
      <View style={styles.rating}>
        {rated ? <Icon name="star" size={13} color={colors.dueDot} /> : null}
        <UIText variant="muted" style={rated ? styles.ratingValue : undefined}>
          {rating}
        </UIText>
      </View>
    </Pressable>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    androidControls: { paddingTop: 12, paddingHorizontal: 20 },
    list: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: 32,
    },
    separator: { height: 10 },
    // The pills scroll edge to edge, past the list's side padding.
    subjects: { marginHorizontal: -20, marginBottom: 12 },
    empty: { alignItems: "center", gap: 4, paddingVertical: 32 },
    emptyTitle: { marginTop: 12, textAlign: "center" },
    emptyBody: { textAlign: "center" },
    row: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 12,
      paddingVertical: 13,
      paddingHorizontal: 16,
      borderRadius: radius.xl3,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    rowPressed: { opacity: 0.6 },
    rowText: { flex: 1, minWidth: 0, gap: 3 },
    title: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    meta: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      columnGap: 8,
      rowGap: 4,
      marginTop: 2,
    },
    metaText: { flexShrink: 1, fontVariant: ["tabular-nums"] },
    rating: { flexDirection: "row", alignItems: "center", gap: 3, paddingTop: 2 },
    ratingValue: { color: colors.fgPrimary, fontVariant: ["tabular-nums"] },
  });
}
