import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { useDeckActions, type DeckActionsDeck } from "@/components/deck-actions";
import { LoadError } from "@/components/load-error";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { NativeContextMenu } from "@/components/ui/native-menu";
import { ProgressBar } from "@/components/ui/progress-bar";
import {
  newCardsAction,
  ScreenHeader,
  searchListKeyboardDismiss,
} from "@/components/ui/screen-header";
import { UIText } from "@/components/ui/text";
import { formatDeckName } from "@/lib/deck-name";
import {
  deckMetaLine,
  seenLabel,
  toDeckRows,
  visibleDeckRows,
  type DeckFilter,
  type DeckRow,
  type DeckSort,
} from "@/lib/deck-rows";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import { openDeck, openSection } from "@/lib/sections";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { DashboardStats, StudyDeckOption } from "@deephaus/api-client";

const FILTERS: Array<{ value: DeckFilter; label: string }> = [
  { value: "all", label: "All decks" },
  { value: "study", label: "To study" },
  { value: "paused", label: "Paused" },
];

const SORTS: Array<{ value: DeckSort; label: string }> = [
  { value: "due", label: "Most to study" },
  { value: "recent", label: "Recently reviewed" },
  { value: "name", label: "Name" },
];

export default function StudyHubScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [decks, setDecks] = useState<StudyDeckOption[]>([]);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<DeckFilter>("all");
  const [sort, setSort] = useState<DeckSort>("due");

  const load = useCallback(async () => {
    try {
      const [{ decks: items }, nextStats] = await Promise.all([
        offlineData.listDecks(),
        offlineData.getDashboardStats().catch(() => null),
      ]);
      setDecks(items);
      // Keep the last numbers if this refresh could not get them.
      setStats((current) => nextStats ?? current);
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

  const rows = useMemo(() => toDeckRows(decks, stats), [decks, stats]);
  const visible = useMemo(
    () => visibleDeckRows(rows, { query: search, filter, sort }),
    [rows, search, filter, sort],
  );
  // Paused decks are set aside, so they don't count as work waiting.
  const hasWork = rows.some((row) => row.status === "study");
  const filtering = filter !== "all" || search.trim().length > 0;

  const deckActions = useDeckActions({
    omit: ["study"],
    onRenamed: (deck, name) =>
      setDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, title: name } : d))),
    onDuplicated: () => void load(),
    onDeleted: (deckId) => setDecks((prev) => prev.filter((d) => d.id !== deckId)),
    onPausedChange: (deck, paused) => {
      setDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, paused } : d)));
      void load();
    },
  });

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
        actions={[
          {
            type: "menu",
            icon: "filter",
            sfIcon: "line.3.horizontal.decrease",
            label: "Filter and sort",
            items: [
              {
                title: "Show",
                items: FILTERS.map((option) => ({
                  label: option.label,
                  selected: filter === option.value,
                  onPress: () => {
                    haptics.selection();
                    setFilter(option.value);
                  },
                })),
              },
              {
                title: "Sort by",
                items: SORTS.map((option) => ({
                  label: option.label,
                  selected: sort === option.value,
                  onPress: () => {
                    haptics.selection();
                    setSort(option.value);
                  },
                })),
              },
            ],
          },
          newCardsAction,
        ]}
      />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        // Virtualised: an imported Anki library can hold hundreds of decks,
        // each row with its own native menu.
        <FlatList
          data={rows.length === 0 ? [] : visible}
          keyExtractor={(row) => row.id}
          renderItem={({ item }) => (
            <DeckListRow row={item} menu={deckActions.entriesFor(toActionsDeck(item))} />
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
                />
              ) : null}
              {rows.length > 0 && !hasWork && !filtering ? (
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
            rows.length === 0 && loadFailed ? (
              <LoadError
                title="Couldn't load your decks"
                onRetry={() => {
                  setLoading(true);
                  void load();
                }}
              />
            ) : rows.length === 0 ? (
              <Card padding={20} style={styles.empty}>
                <FeaturedIcon icon="folder" variant="gray" size="lg" />
                <UIText variant="subtitle" style={styles.emptyTitle}>
                  No decks yet
                </UIText>
                <UIText variant="muted" style={styles.emptyBody}>
                  Make cards from a topic, notes or a link, or add a deck from Community.
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
                  {filter === "paused"
                    ? "No decks are paused."
                    : filter === "study"
                      ? "Nothing is waiting to be studied."
                      : "Try a different deck name."}
                </UIText>
                {filter !== "all" ? (
                  <Button
                    variant="secondary"
                    size="md"
                    label="Show all decks"
                    onPress={() => setFilter("all")}
                    style={{ marginTop: 12 }}
                  />
                ) : null}
              </Card>
            )
          }
        />
      )}
      {deckActions.sheets}
    </>
  );
}

function toActionsDeck(row: DeckRow): DeckActionsDeck {
  return {
    id: row.id,
    title: row.title,
    cardCount: row.total,
    isPublished: row.isPublished,
    isCommunity: row.isCommunity,
    paused: row.paused,
  };
}

function DeckListRow({
  row,
  menu,
}: {
  row: DeckRow;
  menu: ReturnType<ReturnType<typeof useDeckActions>["entriesFor"]>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const deckName = formatDeckName(row.title);
  const seen = seenLabel(row);
  const today =
    row.status === "paused"
      ? "Paused"
      : row.status === "empty"
        ? null
        : row.status === "caught-up"
          ? "Caught up"
          : [row.due > 0 ? `${row.due} due` : null, row.fresh > 0 ? `${row.fresh} new` : null]
              .filter(Boolean)
              .join(", ");

  return (
    <NativeContextMenu label={row.title} entries={menu}>
      {({ onLongPress }) => (
        <View style={[styles.row, row.paused && styles.rowPaused]}>
          <Pressable
            onPress={() => openDeck(row.id)}
            onLongPress={onLongPress}
            accessibilityRole="button"
            accessibilityLabel={[row.title, deckMetaLine(row), today, seen].filter(Boolean).join(", ")}
            accessibilityHint="Opens the deck. Touch and hold for more actions."
            style={({ pressed }) => [styles.rowMain, pressed && { opacity: 0.6 }]}
          >
            {deckName.path != null && (
              <UIText variant="label" style={styles.deckPath} numberOfLines={1}>
                {deckName.path}
              </UIText>
            )}
            <UIText style={styles.deckTitle} numberOfLines={2}>
              {deckName.title}
            </UIText>
            <UIText variant="muted" numberOfLines={1}>
              {deckMetaLine(row)}
            </UIText>
            {row.status === "study" ? (
              <View style={styles.counts}>
                {row.due > 0 ? <CountTag color={colors.dueDot} label={`${row.due} due`} /> : null}
                {row.fresh > 0 ? <CountTag color={colors.accent} label={`${row.fresh} new`} /> : null}
              </View>
            ) : today ? (
              <UIText variant="muted">{today}</UIText>
            ) : null}
            {row.seenShare != null ? (
              <ProgressBar value={row.seenShare} height={3} style={styles.progress} />
            ) : null}
          </Pressable>
          {row.status === "empty" ? (
            <Button
              variant="secondary"
              size="sm"
              label="Add cards"
              onPress={() => openSection("home", { deck: row.id, deckName: row.title })}
            />
          ) : row.paused ? null : (
            <Pressable
              onPress={() => {
                haptics.selection();
                router.push(`/study/${row.id}`);
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={`Study ${row.title}`}
              style={({ pressed }) => [
                styles.study,
                row.status === "study" && styles.studyReady,
                pressed && { opacity: 0.6 },
              ]}
            >
              <Icon
                name="play"
                size={16}
                color={row.status === "study" ? colors.actionBrandFg : colors.fgTertiary}
              />
            </Pressable>
          )}
        </View>
      )}
    </NativeContextMenu>
  );
}

function CountTag({ color, label }: { color: string; label: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={styles.countTag}>
      <View style={[styles.countDot, { backgroundColor: color }]} />
      <UIText variant="muted" style={styles.countLabel}>
        {label}
      </UIText>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    loading: { flex: 1, justifyContent: "center", alignItems: "center" },
    content: { paddingTop: 8, paddingBottom: 32, paddingHorizontal: 20 },
    listHeader: { gap: 12, paddingBottom: 12 },
    separator: { height: 10 },
    empty: { alignItems: "center", gap: 4 },
    emptyTitle: { marginTop: 12 },
    emptyBody: { textAlign: "center" },
    caughtUp: { gap: 2, paddingBottom: 4 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingLeft: 16,
      paddingRight: 14,
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    rowPaused: { opacity: 0.72 },
    rowMain: {
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
    counts: {
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
    countLabel: { color: colors.fgSecondary, fontVariant: ["tabular-nums"] },
    progress: { marginTop: 6 },
    study: {
      width: 38,
      height: 38,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.bgHover,
    },
    studyReady: { backgroundColor: colors.actionBrandBg },
  });
}
