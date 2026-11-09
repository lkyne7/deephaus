import type { BrowseCardRow } from "@deephaus/api-client";
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
import {
  CardBatchToolbar,
  cardSelectionHeaderActions,
  runCardBatchAction,
  type CardBatchAction,
} from "@/components/card-batch-toolbar";
import { useDeckActions } from "@/components/deck-actions";
import { RichCardContent } from "@/components/rich-card-content";
import { BadgePill } from "@/components/ui/badge-pill";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Icon } from "@/components/ui/icon";
import { ProgressBar } from "@/components/ui/progress-bar";
import { ScreenHeader } from "@/components/ui/screen-header";
import { LoadError } from "@/components/load-error";
import { api } from "@/lib/api";
import { formatDeckName } from "@/lib/deck-name";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { plainCardText } from "@/lib/card-preview";
import { useTheme } from "@/lib/theme-context";
import { openSection } from "@/lib/sections";
import { cardTypeLabel } from "@deephaus/shared";

const CARD_PAGE_SIZE = 50;

/** A deck: study it, add to it, and work through its cards. */
export default function DeckScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { deckId: id, tab: tabParam } = useLocalSearchParams<{ deckId: string; tab?: string }>();
  const { tasks, dismissTask, getTaskForProject, recentRuns, markRunSeen, dismissRunNotice } =
    useBackgroundTasks();
  const task = id ? getTaskForProject(id) : undefined;
  const run = id ? recentRuns[id] : undefined;
  const [published, setPublished] = useState(false);
  const [deckName, setDeckName] = useState<string | null>(null);
  // undefined until the first stats load, so the header can wait for it.
  const [counts, setCounts] = useState<{ due: number; fresh: number } | null | undefined>(
    undefined,
  );

  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [cardTotal, setCardTotal] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [cardsFailed, setCardsFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());
  const [creatingCard, setCreatingCard] = useState(false);
  const [focused, setFocused] = useState(true);
  const cardsRequestRef = useRef(0);
  const loadedOnceRef = useRef(false);

  const deckActions = useDeckActions({
    omit: ["open", "create"],
    onRenamed: (_deck, name) => setDeckName(name),
    onDuplicated: (copy) => router.replace(`/decks/${copy.id}`),
    // Back to the top of Decks, wherever this page was opened from.
    onDeleted: () => openSection("decks"),
    onPublishedChange: (_deck, next) => setPublished(next),
  });

  // Live Activities from older builds still ask for the old Cards tab; the
  // cards are the page now, so just drop the param.
  useEffect(() => {
    if (tabParam) router.setParams({ tab: undefined });
  }, [tabParam]);

  // The same screen can be handed another deck (the sidebar's Recent decks);
  // start it clean rather than showing the last deck's cards under this title.
  useEffect(() => {
    loadedOnceRef.current = false;
    setCards([]);
    setCardTotal(0);
    setCounts(undefined);
    setDeckName(null);
    setSelected(new Set());
    setCardsLoading(true);
  }, [id]);

  const loadDeckInfo = useCallback(() => {
    if (!id) return;
    void api
      .getPublication(id)
      .then((pub) => setPublished(Boolean(pub)))
      .catch(() => undefined);
    void offlineData
      .listProjects()
      .then((projects) => {
        const project = projects.find((item) => item.id === id);
        setDeckName(project ? formatDeckName(project.deck_name || project.name).title : null);
      })
      .catch(() => undefined);
  }, [id]);

  const loadCards = useCallback(
    async (offset = 0, append = false, silent = false) => {
      if (!id) return;
      const requestId = ++cardsRequestRef.current;
      if (append) {
        setLoadingMore(true);
      } else if (!silent) {
        setCardsLoading(true);
      }
      try {
        // Deck order already puts the newest batch first: each generated batch
        // and each card added here is placed before the existing cards.
        const result = await offlineData.browseCards({
          deck_id: id,
          limit: CARD_PAGE_SIZE,
          offset,
        });
        if (requestId !== cardsRequestRef.current) return;
        setCards((prev) => {
          if (!append) return result.cards;
          const existing = new Set(prev.map((card) => card.id));
          return [...prev, ...result.cards.filter((card) => !existing.has(card.id))];
        });
        setCardTotal(result.total);
        setCardsFailed(false);
      } catch {
        if (requestId === cardsRequestRef.current && !append && !silent) {
          setCards([]);
          setCardsFailed(true);
        }
      } finally {
        if (requestId === cardsRequestRef.current) {
          setCardsLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [id],
  );

  // Reload on every return so edits and deletes made in the card editor show.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void loadCards(0, false, loadedOnceRef.current);
      loadedOnceRef.current = true;
      // A rename made in a session or the Decks list shows on return.
      loadDeckInfo();
      void offlineData
        .getDashboardStats()
        .then((stats) => {
          const deck = stats.per_deck.find((item) => item.deck_id === id);
          setCounts(deck ? { due: deck.due, fresh: deck.new } : null);
        })
        .catch(() => setCounts((prev) => prev ?? null));
      return () => setFocused(false);
    }, [id, loadCards, loadDeckInfo]),
  );

  // "New" badges for the latest run's cards, until this screen is left.
  const badgeJobId = run && !run.badgesSeen ? run.jobId : null;
  useEffect(() => {
    if (!badgeJobId) {
      setNewCardIds(new Set());
      return;
    }
    let current = true;
    void offlineData
      .listJobCardIds(badgeJobId)
      .then((ids) => {
        if (current) setNewCardIds(new Set(ids));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [badgeJobId]);

  useEffect(() => {
    if (!id) return;
    return () => markRunSeen(id);
  }, [id, markRunSeen]);

  // A run that finishes while this screen is open shows its cards.
  const mountedAtRef = useRef(Date.now());
  const lastRunTaskRef = useRef(run?.taskId);
  useEffect(() => {
    if (!run || run.taskId === lastRunTaskRef.current) return;
    lastRunTaskRef.current = run.taskId;
    if (run.finishedAt < mountedAtRef.current) return;
    setSelected(new Set());
    void loadCards(0, false, true);
  }, [run, loadCards]);

  // The notice here replaces the banner while this deck is on screen.
  useEffect(() => {
    if (!focused || !id || !run) return;
    for (const item of tasks) {
      if (item.id === run.taskId && item.status === "ready") dismissTask(item.id);
    }
  }, [focused, id, run, tasks, dismissTask]);

  async function addCard(type: "basic" | "cloze") {
    if (!id || creatingCard) return;
    setCreatingCard(true);
    try {
      const card = await offlineData.createCard({
        project_id: id,
        type,
        append: false,
      });
      router.push(`/decks/card/${card.id}?blank=1`);
    } catch (e) {
      Alert.alert("Could not create card", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCreatingCard(false);
    }
  }

  function toggleSelect(cardId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  async function batchAction(action: CardBatchAction) {
    if (!(await runCardBatchAction(action, Array.from(selected)))) return;
    setSelected(new Set());
    await loadCards(0, false, true);
  }

  const selecting = selected.size > 0;
  const ready = (counts?.due ?? 0) + (counts?.fresh ?? 0);
  const title = deckName ?? "Deck";

  function addCards() {
    if (!id) return;
    openSection("home", { deck: id, deckName: title });
  }

  const runNotice =
    id && run && !run.noticeDismissed ? (
      <View style={styles.notice}>
        <Text style={styles.noticeText}>
          <Text style={styles.noticeStrong}>
            {run.cardsAdded > 0
              ? `${run.cardsAdded} card${run.cardsAdded === 1 ? "" : "s"} added`
              : "No new cards"}
          </Text>
          {` from ${run.sourceLabel}`}
        </Text>
        <Pressable
          onPress={() => dismissRunNotice(id)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
        >
          <Icon name="close" size={16} color={colors.fgQuaternary} />
        </Pressable>
      </View>
    ) : null;

  return (
    <View style={styles.root}>
      <ScreenHeader
        // The page's own title sits below the bar on iOS.
        title={selecting ? `${selected.size} selected` : Platform.OS === "ios" ? "" : title}
        backFallback="/decks"
        actions={
          selecting
            ? cardSelectionHeaderActions(
                selected.size,
                (action) => void batchAction(action),
                () => setSelected(new Set()),
              )
            : id
              ? [
                  {
                    type: "menu",
                    // A compose icon, not "+": elsewhere "+" makes cards with AI.
                    icon: "pen",
                    sfIcon: "square.and.pencil",
                    label: "Write a card by hand",
                    disabled: creatingCard,
                    items: [
                      {
                        label: "Front / Back",
                        sfIcon: "rectangle.on.rectangle",
                        onPress: () => void addCard("basic"),
                      },
                      {
                        label: "Fill-in (cloze)",
                        sfIcon: "text.badge.plus",
                        onPress: () => void addCard("cloze"),
                      },
                    ],
                  },
                  {
                    type: "menu",
                    icon: "more",
                    sfIcon: "ellipsis",
                    label: "Deck actions",
                    items: deckActions.entriesFor({
                      id,
                      title,
                      cardCount: cardTotal,
                      isPublished: published,
                    }),
                  },
                ]
              : undefined
        }
      />
      <CardBatchToolbar count={selected.size} onAction={(action) => void batchAction(action)} />
      <FlatList
        data={cardsLoading ? [] : cards}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.cardList}
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          // Wait for the first load, so the name, counts and Study button arrive
          // together instead of popping in and pushing Add cards down.
          (cardsLoading && cards.length === 0) ||
          counts === undefined ||
          (cardsFailed && cards.length === 0) ? null : (
            <View style={styles.header}>
              <View>
                <Text style={styles.title} accessibilityRole="header">
                  {title}
                </Text>
                <Text style={styles.summaryText}>
                  {cardTotal.toLocaleString()} card{cardTotal === 1 ? "" : "s"}
                  {counts && counts.due > 0 ? (
                    <Text style={styles.due}>{` · ${counts.due.toLocaleString()} due`}</Text>
                  ) : null}
                  {counts && counts.fresh > 0 ? ` · ${counts.fresh.toLocaleString()} new` : ""}
                </Text>
              </View>
              {cardTotal > 0 ? (
                <Button
                  size="lg"
                  label={
                    ready > 0
                      ? `Study ${ready.toLocaleString()} card${ready === 1 ? "" : "s"}`
                      : "Study"
                  }
                  fullWidth
                  onPress={() => router.push(`/study/${id}`)}
                />
              ) : null}
              <Button
                variant="secondary"
                size="lg"
                label="Add cards"
                leadingIcon="add"
                fullWidth
                onPress={addCards}
              />
              {task ? (
                <Pressable
                  onPress={() => openSection("home", { task: task.id })}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.message, pressed && styles.pressed]}
                >
                  <Text style={styles.messageText}>{taskPhaseLabel(task)}</Text>
                  <ProgressBar value={task.progress / 100} />
                </Pressable>
              ) : null}
              {runNotice}
              {cardTotal > 0 ? <Text style={styles.sectionTitle}>Cards</Text> : null}
            </View>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void loadCards(0, false, true).finally(() => setRefreshing(false));
            }}
            tintColor={colors.accent}
          />
        }
        onEndReachedThreshold={0.3}
        onEndReached={() => {
          if (cardsLoading || loadingMore || cards.length >= cardTotal) return;
          void loadCards(cards.length, true);
        }}
        ListFooterComponent={
          loadingMore ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : null
        }
        renderItem={({ item }) => (
          <MiniCard
            card={item}
            isNew={newCardIds.has(item.id)}
            selected={selected.has(item.id)}
            onPress={() =>
              selected.size > 0 ? toggleSelect(item.id) : router.push(`/decks/card/${item.id}`)
            }
            onLongPress={() => toggleSelect(item.id)}
          />
        )}
        ListEmptyComponent={
          cardsLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
          ) : cardsFailed ? (
            <LoadError title="Couldn't load this deck" onRetry={() => void loadCards(0, false)} />
          ) : (
            <View style={styles.empty}>
              <FeaturedIcon icon="layers" variant="gray" size="lg" />
              <Text style={styles.emptyTitle}>No cards yet</Text>
              <Text style={styles.emptyBody}>
                Make cards from a topic, notes or a link, or add one by hand.
              </Text>
            </View>
          )
        }
      />
      {deckActions.sheets}
    </View>
  );
}

/** A deck's card row: sans like every list row, quiet meta below. */
function MiniCard({
  card,
  selected,
  isNew,
  onPress,
  onLongPress,
}: {
  card: BrowseCardRow;
  selected: boolean;
  isNew: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createMiniCardStyles(colors), [colors]);
  const back = card.back && card.type === "basic" ? plainCardText(card.back) : "";
  const tags = card.tags
    .slice(0, 2)
    .map((tag) => ` · #${tag}`)
    .join("");
  const dim = card.suspended && styles.dimmed;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={() => {
        haptics.selection();
        onLongPress();
      }}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityHint="Opens the card. Long press to select for bulk actions."
      style={({ pressed }) => [pressed && { opacity: 0.85 }]}
    >
      <Card padding={14} style={selected && styles.selected}>
        <View style={dim}>
          <RichCardContent
            content={card.type === "basic" ? (card.front ?? "") : (card.cloze_text ?? "")}
            imageHeight={120}
            textStyle={styles.front}
          />
        </View>
        {back ? (
          <>
            <View style={styles.divider} />
            <Text style={[styles.back, dim]} numberOfLines={2}>
              {back}
            </Text>
          </>
        ) : null}
        <View style={styles.meta}>
          <Text style={styles.metaText} numberOfLines={1}>
            {isNew ? <Text style={styles.new}>New · </Text> : null}
            {cardTypeLabel(card.type, "short")}
            {tags}
          </Text>
          {card.suspended ? <BadgePill label="Suspended" icon="pausePlayback" tone="gray" /> : null}
        </View>
      </Card>
    </Pressable>
  );
}

function createMiniCardStyles(colors: ThemeColors) {
  return StyleSheet.create({
    selected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    dimmed: { opacity: 0.5 },
    divider: { height: 1, backgroundColor: colors.line, marginVertical: 10 },
    front: { fontSize: 16, lineHeight: 22, fontWeight: "500", color: colors.fgPrimary },
    back: { fontSize: 15, lineHeight: 21, color: colors.fgSecondary },
    meta: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 10 },
    metaText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    new: { color: colors.accentInk, fontWeight: "500" },
  });
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    cardList: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
    pressed: { opacity: 0.6 },
    header: { gap: 12, paddingBottom: 12 },
    title: {
      fontSize: 28,
      lineHeight: 34,
      fontWeight: "700",
      letterSpacing: -0.4,
      color: colors.fgPrimary,
    },
    summaryText: { marginTop: 2, fontSize: 15, lineHeight: 20, color: colors.fgTertiary },
    due: { color: colors.orange600 },
    sectionTitle: {
      marginTop: 8,
      fontSize: 15,
      lineHeight: 20,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    message: { gap: 10 },
    messageText: { fontSize: 15, lineHeight: 20, color: colors.fgPrimary },
    notice: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    noticeText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.fgPrimary },
    noticeStrong: { fontWeight: "600" },
    empty: { alignItems: "center", gap: 4, paddingVertical: 24 },
    emptyTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    emptyBody: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
    },
  });
}
