import type { BrowseCardRow } from "@deephaus/api-client";
import * as DocumentPicker from "expo-document-picker";
import { router, useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
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
import { OfflineNotice } from "@/components/offline-notice";
import { RichCardContent } from "@/components/rich-card-content";
import { BadgePill } from "@/components/ui/badge-pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { FilterPills } from "@/components/ui/filter-pills";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import { NativeMenu } from "@/components/ui/native-menu";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { formatDeckName } from "@/lib/deck-name";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { plainCardText } from "@/lib/card-preview";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";
import {
  cardTypeLabel,
  DEFAULT_FOCUS_PRESET,
  FOCUS_PRESET_OPTIONS,
  type CardMix,
  type DetailLevel,
  type FocusPreset,
  type GenerationSettings,
} from "@deephaus/shared";

type SourceTab = "text" | "doc" | "video" | "web" | "topic";
type DeckTab = "generate" | "cards";

const CARD_PAGE_SIZE = 50;

const SOURCE_TABS: { value: SourceTab; label: string }[] = [
  { value: "text", label: "Free text" },
  { value: "doc", label: "Document" },
  { value: "video", label: "Video" },
  { value: "web", label: "Website" },
  { value: "topic", label: "Topic" },
];

const CARD_TYPES: { id: CardMix; label: string }[] = [
  { id: "basic", label: "Front/Back" },
  { id: "cloze", label: "Fill-in" },
];

const DETAIL_LEVELS: { id: DetailLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

export default function ProjectDetailScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { id, tab: tabParam } = useLocalSearchParams<{ id: string; tab?: string }>();
  const {
    tasks,
    dismissTask,
    getTaskForProject,
    recentRuns,
    markRunSeen,
    dismissRunNotice,
    startGenerationFromText,
    startGenerationFromFile,
    startGenerationFromYoutube,
    startGenerationFromWebsite,
    startGenerationFromTopic,
  } = useBackgroundTasks();
  const [tab, setTab] = useState<DeckTab>(tabParam === "cards" ? "cards" : "generate");
  const [source, setSource] = useState<SourceTab>("text");
  const [text, setText] = useState("");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [topic, setTopic] = useState("");
  const task = id ? getTaskForProject(id) : undefined;
  const run = id ? recentRuns[id] : undefined;
  const [detailLevel, setDetailLevel] = useState<DetailLevel>("medium");
  const [cardType, setCardType] = useState<CardMix>("basic");
  const [focusPreset, setFocusPreset] = useState<FocusPreset>(DEFAULT_FOCUS_PRESET);
  const [published, setPublished] = useState(false);
  const [deckName, setDeckName] = useState<string | null>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);

  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [cardTotal, setCardTotal] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());
  const [creatingCard, setCreatingCard] = useState(false);
  const [focused, setFocused] = useState(true);
  const cardsRequestRef = useRef(0);
  const loadedOnceRef = useRef(false);

  const settings: Partial<GenerationSettings> = {
    detailLevel,
    cardMix: cardType,
    focusPreset,
  };
  const meta = { deckName: deckName ?? undefined };
  const deckActions = useDeckActions({
    omit: ["open", "create"],
    onRenamed: (_deck, name) => setDeckName(name),
    onDuplicated: (copy) => router.replace(`/(tabs)/create/${copy.id}`),
    onDeleted: () => router.replace("/(tabs)/create"),
    onPublishedChange: (_deck, next) => setPublished(next),
  });

  // The finished-generation banner opens this screen on the Cards tab.
  useEffect(() => {
    if (tabParam === "cards") {
      setTab("cards");
      router.setParams({ tab: undefined });
    }
  }, [tabParam]);

  useEffect(() => {
    if (!id) return;
    void api.getPublication(id).then((pub) => setPublished(Boolean(pub)));
    void api
      .getDeck(id)
      .then((project) => setDeckName(formatDeckName(project.deck_name || project.name).title))
      .catch(() => setDeckName(null));
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
      } catch {
        if (requestId === cardsRequestRef.current && !append && !silent) setCards([]);
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
      return () => setFocused(false);
    }, [loadCards]),
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

  // A run that finishes while this screen is open switches to its cards.
  const mountedAtRef = useRef(Date.now());
  const lastRunTaskRef = useRef(run?.taskId);
  useEffect(() => {
    if (!run || run.taskId === lastRunTaskRef.current) return;
    lastRunTaskRef.current = run.taskId;
    if (run.finishedAt < mountedAtRef.current) return;
    setTab("cards");
    setSelected(new Set());
    void loadCards(0, false, true);
  }, [run, loadCards]);

  // The notice on the Cards tab replaces the banner while this deck is on screen.
  useEffect(() => {
    if (!focused || !id || !run) return;
    for (const item of tasks) {
      if (item.id === run.taskId && item.status === "ready") dismissTask(item.id);
    }
  }, [focused, id, run, tasks, dismissTask]);

  async function pickFile(type: "pdf" | "any") {
    if (!id) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: type === "pdf" ? "application/pdf" : "*/*",
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    startGenerationFromFile(
      id,
      asset.uri,
      asset.name,
      type,
      settings,
      asset.size,
      asset.mimeType,
      meta,
    );
  }

  // Inputs clear once a run starts, so tapping Generate again can't add the same source twice.
  function startGeneration() {
    if (!id) return;
    if (source === "text") {
      if (!text.trim()) return;
      startGenerationFromText(id, text, settings, meta);
      setText("");
      return;
    }
    if (source === "video") {
      if (!youtubeUrl.trim()) return;
      startGenerationFromYoutube(id, youtubeUrl.trim(), settings, meta);
      setYoutubeUrl("");
      return;
    }
    if (source === "web") {
      if (!websiteUrl.trim()) return;
      startGenerationFromWebsite(id, websiteUrl.trim(), settings, meta);
      setWebsiteUrl("");
      return;
    }
    if (source === "topic") {
      if (topic.trim().length < 3) return;
      startGenerationFromTopic(id, topic.trim(), settings, meta);
      setTopic("");
      return;
    }
    void pickFile("pdf");
  }

  async function addCard(type: "basic" | "cloze") {
    if (!id || creatingCard) return;
    setCreatingCard(true);
    try {
      const card = await offlineData.createCard({
        project_id: id,
        type,
        append: false,
      });
      router.push(`/(tabs)/create/card/${card.id}`);
    } catch (e) {
      Alert.alert(
        "Could not create card",
        e instanceof Error ? e.message : "Unknown error",
      );
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

  const online = useOnline();
  const canGenerate =
    online &&
    (source === "text"
      ? text.trim().length > 0
      : source === "video"
        ? youtubeUrl.trim().length > 0
        : source === "web"
          ? websiteUrl.trim().length > 0
          : source === "topic"
            ? topic.trim().length >= 3
            : true);

  const selecting = tab === "cards" && selected.size > 0;
  const addFileDisabled = Boolean(task) || !online;
  const addFileEntries: NativeMenuEntry[] = [
    { label: "Upload a PDF", sfIcon: "doc.richtext", onPress: () => void pickFile("pdf") },
    { label: "Pick any file", sfIcon: "folder", onPress: () => void pickFile("any") },
  ];
  const addCardEntries: NativeMenuEntry[] = [
    { label: "Front / Back", sfIcon: "rectangle.on.rectangle", onPress: () => void addCard("basic") },
    { label: "Fill-in (cloze)", sfIcon: "text.badge.plus", onPress: () => void addCard("cloze") },
  ];
  const optionsSummary = [
    DETAIL_LEVELS.find((option) => option.id === detailLevel)?.label,
    CARD_TYPES.find((option) => option.id === cardType)?.label,
    FOCUS_PRESET_OPTIONS.find((option) => option.value === focusPreset)?.label,
  ].join(" · ");

  const tabSwitcher = (
    <SegmentedControl<DeckTab>
      options={[
        { value: "generate", label: "Generate" },
        { value: "cards", label: cardTotal > 0 ? `Cards (${cardTotal})` : "Cards" },
      ]}
      value={tab}
      onChange={(next) => {
        setTab(next);
        setSelected(new Set());
      }}
      accessibilityLabel="Deck view"
    />
  );

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
        title={selecting ? `${selected.size} selected` : deckName ?? "Create"}
        backFallback="/(tabs)/create"
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
                    icon: "more",
                    sfIcon: "ellipsis",
                    label: "Deck actions",
                    items: deckActions.entriesFor({
                      id,
                      title: deckName ?? "Deck",
                      cardCount: cardTotal,
                      isPublished: published,
                    }),
                  },
                ]
              : undefined
        }
      />
      {tab === "generate" ? (
        <KeyboardScreen>
          <ScrollView
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
          >
            {tabSwitcher}
            {!online && <OfflineNotice feature="AI card generation" />}
            {task ? (
              <View style={styles.message}>
                <Text style={styles.messageText}>{taskPhaseLabel(task)}</Text>
                <ProgressBar value={task.progress / 100} />
                <Text style={styles.helper}>
                  You can switch tabs while this runs. New cards appear under Cards.
                </Text>
              </View>
            ) : (
              <View style={styles.greetingRow}>
                <BrandMark size={24} />
                <Text style={styles.greeting}>What should these cards cover?</Text>
              </View>
            )}

            <Card raised style={styles.composer}>
              {source === "text" && (
                <View>
                  <Field
                    value={text}
                    onChangeText={setText}
                    placeholder="Paste notes, transcripts, or any text"
                    accessibilityLabel="Paste notes, transcripts, or any text"
                    multiline
                    containerStyle={styles.composerField}
                    inputStyle={styles.composerTextarea}
                  />
                  <Text style={styles.composerHelper}>{text.length} characters</Text>
                </View>
              )}

              {source === "doc" && (
                // The button sits beside the Pressable, not in it: a native
                // button can't claim the touch, so both would fire.
                <View style={styles.dropzone}>
                  <Pressable
                    onPress={() => void pickFile("pdf")}
                    style={({ pressed }) => [styles.dropzoneMain, pressed && { opacity: 0.7 }]}
                  >
                    <Icon name="upload" size={24} color={colors.fgTertiary} />
                    <Text style={styles.dropzoneTitle}>Tap to upload a PDF</Text>
                    <Text style={styles.dropzoneSub}>Up to 2000 pages</Text>
                  </Pressable>
                  <Button
                    variant="tertiary"
                    size="sm"
                    label="Or pick any file"
                    onPress={() => void pickFile("any")}
                  />
                </View>
              )}

              {source === "video" && (
                <View>
                  <Field
                    leadingIcon="youtube"
                    value={youtubeUrl}
                    onChangeText={setYoutubeUrl}
                    placeholder="Paste a YouTube URL"
                    accessibilityLabel="YouTube URL"
                    autoCapitalize="none"
                    autoCorrect={false}
                    containerStyle={styles.composerField}
                  />
                  <Text style={styles.composerHelper}>We'll use the video's transcript.</Text>
                </View>
              )}

              {source === "web" && (
                <View>
                  <Field
                    leadingIcon="externalLink"
                    value={websiteUrl}
                    onChangeText={setWebsiteUrl}
                    placeholder="Paste a website URL"
                    accessibilityLabel="Website URL"
                    autoCapitalize="none"
                    autoCorrect={false}
                    containerStyle={styles.composerField}
                  />
                  <Text style={styles.composerHelper}>
                    We'll import the page's readable content as a source.
                  </Text>
                </View>
              )}

              {source === "topic" && (
                <View>
                  <Field
                    leadingIcon="sparklesOutline"
                    value={topic}
                    onChangeText={setTopic}
                    placeholder="Name a topic, e.g. the Krebs cycle"
                    accessibilityLabel="What do you want to learn?"
                    containerStyle={styles.composerField}
                  />
                  <Text style={styles.composerHelper}>
                    No source needed. AI builds a starter deck from the topic.
                  </Text>
                </View>
              )}

              <View style={styles.composerRow}>
                <NativeMenu label="Add a file" entries={addFileEntries} disabled={addFileDisabled}>
                  <View style={styles.composerPlus}>
                    <Icon name="add" size={18} color={colors.fgSecondary} />
                  </View>
                </NativeMenu>
                <Pressable
                  onPress={() => setOptionsOpen((open) => !open)}
                  accessibilityRole="button"
                  accessibilityLabel="Card settings"
                  accessibilityValue={{ text: optionsSummary }}
                  accessibilityState={{ expanded: optionsOpen }}
                  style={({ pressed }) => [styles.composerTool, pressed && styles.pressed]}
                >
                  <Icon name="filter" size={15} color={colors.fgTertiary} />
                  <Text style={styles.composerToolLabel} numberOfLines={1}>
                    {optionsSummary}
                  </Text>
                  <Icon
                    name="arrowDown"
                    size={14}
                    color={colors.fgTertiary}
                    style={optionsOpen ? styles.chevronOpen : undefined}
                  />
                </Pressable>
                <Pressable
                  onPress={startGeneration}
                  disabled={Boolean(task) || !canGenerate}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={task ? "Generating in background…" : "Generate cards"}
                  accessibilityState={{ disabled: Boolean(task) || !canGenerate }}
                  style={({ pressed }) => [
                    styles.send,
                    (Boolean(task) || !canGenerate) && styles.sendOff,
                    pressed && styles.pressed,
                  ]}
                >
                  <Icon
                    name="arrowRight"
                    size={17}
                    color={colors.actionBrandFg}
                    style={styles.sendIcon}
                  />
                </Pressable>
              </View>
            </Card>

            <FilterPills<SourceTab>
              options={SOURCE_TABS}
              value={source}
              onChange={setSource}
              accessibilityLabel="Source"
              style={styles.sources}
            />

            {optionsOpen && (
              <View style={styles.settings}>
                <View>
                  <Text style={styles.fieldLabel}>Level of detail</Text>
                  <SegmentedControl<DetailLevel>
                    options={DETAIL_LEVELS.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                    value={detailLevel}
                    onChange={setDetailLevel}
                    accessibilityLabel="Level of detail"
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Card type</Text>
                  <SegmentedControl<CardMix>
                    options={CARD_TYPES.map((option) => ({
                      value: option.id,
                      label: option.label,
                    }))}
                    value={cardType}
                    onChange={setCardType}
                    accessibilityLabel="Card type"
                  />
                </View>

                <View>
                  <Text style={styles.fieldLabel}>Focus</Text>
                  {FOCUS_PRESET_OPTIONS.map((option, index) => {
                    const active = option.value === focusPreset;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setFocusPreset(option.value)}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        style={({ pressed }) => [
                          styles.focusOption,
                          index > 0 && styles.focusOptionLine,
                          pressed && styles.pressed,
                        ]}
                      >
                        <View style={styles.focusOptionText}>
                          <Text style={styles.focusOptionLabel}>{option.label}</Text>
                          <Text style={styles.focusOptionDesc}>{option.description}</Text>
                        </View>
                        {active && <Icon name="check" size={16} color={colors.accent} />}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            )}
          </ScrollView>
        </KeyboardScreen>
      ) : (
        <>
          <CardBatchToolbar
            count={selected.size}
            onAction={(action) => void batchAction(action)}
          />
          <FlatList
            data={cardsLoading ? [] : cards}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.cardList}
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View style={styles.cardsHeader}>
                {tabSwitcher}
                {runNotice}
                <View style={styles.cardsSummary}>
                  <Text style={styles.summaryText}>
                    {cardTotal} card{cardTotal === 1 ? "" : "s"}
                  </Text>
                  <NativeMenu label="Add a card" entries={addCardEntries} disabled={creatingCard}>
                    <View style={styles.addCard}>
                      {creatingCard ? (
                        <ActivityIndicator size="small" color={colors.fgSecondary} />
                      ) : (
                        <Icon name="add" size={15} color={colors.fgSecondary} />
                      )}
                      <Text style={styles.addCardLabel}>Add card</Text>
                    </View>
                  </NativeMenu>
                </View>
              </View>
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
                  selected.size > 0
                    ? toggleSelect(item.id)
                    : router.push(`/(tabs)/create/card/${item.id}`)
                }
                onLongPress={() => toggleSelect(item.id)}
              />
            )}
            ListEmptyComponent={
              cardsLoading ? (
                <ActivityIndicator color={colors.accent} style={{ marginTop: 24 }} />
              ) : (
                <View style={styles.empty}>
                  <FeaturedIcon icon="layers" variant="gray" size="lg" />
                  <Text style={styles.emptyTitle}>No cards yet</Text>
                  <Text style={styles.emptyBody}>
                    Generate cards from a source, or add one by hand.
                  </Text>
                  <Button
                    variant="secondary"
                    size="sm"
                    label="Generate cards"
                    leadingIcon="sparkles"
                    onPress={() => setTab("generate")}
                    style={{ marginTop: 8 }}
                  />
                </View>
              )
            }
          />
        </>
      )}
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
  const tags = card.tags.slice(0, 2).map((tag) => ` · #${tag}`).join("");
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
            content={card.type === "basic" ? card.front ?? "" : card.cloze_text ?? ""}
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
          {card.suspended ? (
            <BadgePill label="Suspended" icon="pausePlayback" tone="gray" />
          ) : null}
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
    content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 16 },
    cardList: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32 },
    pressed: { opacity: 0.6 },
    greetingRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 },
    greeting: {
      flex: 1,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    message: { gap: 10, marginTop: 8 },
    messageText: { fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    helper: { fontSize: 12, lineHeight: 17, color: colors.fgTertiary },
    composer: {
      borderRadius: radius.xl4,
      paddingTop: 12,
      paddingHorizontal: 12,
      paddingBottom: 10,
      gap: 10,
    },
    composerField: {
      minHeight: 46,
      alignItems: "flex-start",
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderWidth: 0,
      backgroundColor: "transparent",
    },
    composerTextarea: { textAlignVertical: "top", minHeight: 96, maxHeight: 240 },
    composerHelper: {
      fontSize: 12,
      lineHeight: 17,
      color: colors.fgTertiary,
      paddingHorizontal: 6,
    },
    composerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    composerPlus: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    composerTool: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      flexShrink: 1,
      marginRight: "auto",
      height: 36,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    composerToolLabel: { flexShrink: 1, fontSize: 13, lineHeight: 18, color: colors.fgSecondary },
    chevronOpen: { transform: [{ rotate: "180deg" }] },
    send: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
      borderRadius: radius.pill,
      backgroundColor: colors.actionBrandBg,
    },
    sendOff: { opacity: 0.38 },
    sendIcon: { transform: [{ rotate: "-90deg" }] },
    dropzone: {
      paddingVertical: 24,
      paddingHorizontal: 16,
      borderColor: colors.lineStrong,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: radius.xl2,
      backgroundColor: colors.bgCanvas,
      alignItems: "center",
      gap: 4,
    },
    dropzoneMain: { alignItems: "center", gap: 4 },
    dropzoneTitle: {
      fontSize: 14,
      lineHeight: 20,
      fontWeight: "500",
      color: colors.fgPrimary,
      marginTop: 4,
    },
    dropzoneSub: { fontSize: 12, lineHeight: 17, color: colors.fgTertiary },
    // FilterPills pads itself by the same 20 as the screen.
    sources: { marginHorizontal: -20 },
    settings: { gap: 16, paddingTop: 4 },
    fieldLabel: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      marginBottom: 6,
    },
    focusOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      minHeight: 48,
      paddingVertical: 10,
    },
    focusOptionLine: { borderTopColor: colors.line, borderTopWidth: 1 },
    focusOptionText: { flex: 1, gap: 2 },
    focusOptionLabel: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    focusOptionDesc: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    cardsHeader: { gap: 12, paddingBottom: 12 },
    notice: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
    noticeText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.fgPrimary },
    noticeStrong: { fontWeight: "600" },
    cardsSummary: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
    },
    summaryText: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    addCard: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    addCardLabel: { fontSize: 14, lineHeight: 20, fontWeight: "500", color: colors.fgPrimary },
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
