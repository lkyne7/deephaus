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
import { CardListItem } from "@/components/card-list-item";
import { DeckActionsSheet } from "@/components/deck-actions-sheet";
import { OfflineNotice } from "@/components/offline-notice";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeckSelectModal } from "@/components/ui/deck-select";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { Icon, type IconName } from "@/components/ui/icon";
import { ScreenHeader } from "@/components/ui/screen-header";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ProgressBar } from "@/components/ui/progress-bar";
import { api } from "@/lib/api";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { formatDeckName } from "@/lib/deck-name";
import { useBackgroundTasks, taskPhaseLabel } from "@/lib/background-tasks-context";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";
import {
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

const SOURCE_TABS: { id: SourceTab; icon: IconName; label: string }[] = [
  { id: "text", icon: "text", label: "Free text" },
  { id: "doc", icon: "document", label: "Document" },
  { id: "video", icon: "playOutline", label: "Video" },
  { id: "web", icon: "externalLink", label: "Website" },
  { id: "topic", icon: "sparklesOutline", label: "Topic" },
];

const CARD_TYPES: { id: CardMix; icon: IconName; label: string }[] = [
  { id: "basic", icon: "bubbleSingle", label: "Front/Back" },
  { id: "cloze", icon: "textSnippet", label: "Fill-in" },
];

const DETAIL_LEVELS: { id: DetailLevel; label: string }[] = [
  { id: "low", label: "Low" },
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

const NEW_CARD_TYPES = [
  { id: "basic", label: "Front / Back" },
  { id: "cloze", label: "Fill-in (cloze)" },
] as const;

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
  const [actionsOpen, setActionsOpen] = useState(false);

  const [cards, setCards] = useState<BrowseCardRow[]>([]);
  const [cardTotal, setCardTotal] = useState(0);
  const [cardsLoading, setCardsLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newCardIds, setNewCardIds] = useState<Set<string>>(new Set());
  const [cardTypePickerOpen, setCardTypePickerOpen] = useState(false);
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
        <Icon name="checkCircle" size={18} color={colors.brand600} />
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
                    icon: "more",
                    sfIcon: "ellipsis.circle",
                    label: "Deck actions",
                    onPress: () => setActionsOpen(true),
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
            <Card padding={16} style={{ gap: 14 }}>
              <Text style={styles.sectionTitle}>Source</Text>
              <View style={styles.sourceChips}>
                {SOURCE_TABS.map((option) => {
                  const active = option.id === source;
                  return (
                    <Pressable
                      key={option.id}
                      onPress={() => setSource(option.id)}
                      style={[styles.sourceChip, active && styles.sourceChipActive]}
                    >
                      <Icon
                        name={option.icon}
                        size={14}
                        color={active ? colors.brand600 : colors.fgTertiary}
                      />
                      <Text style={[styles.sourceChipLabel, active && styles.sourceChipLabelActive]}>
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {source === "text" && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>Paste notes, transcripts, or any text</Text>
                  <Field
                    value={text}
                    onChangeText={setText}
                    placeholder="Paste your source material here..."
                    multiline
                    containerStyle={styles.textarea}
                    inputStyle={{ textAlignVertical: "top", minHeight: 140 }}
                  />
                  <Text style={styles.helper}>{text.length} characters</Text>
                </View>
              )}

              {source === "doc" && (
                <Pressable
                  onPress={() => void pickFile("pdf")}
                  style={({ pressed }) => [styles.dropzone, pressed && { opacity: 0.7 }]}
                >
                  <FeaturedIcon icon="upload" variant="gray" size="lg" />
                  <Text style={styles.dropzoneTitle}>Tap to upload a PDF</Text>
                  <Text style={styles.dropzoneSub}>Up to 2000 pages</Text>
                  <Button
                    variant="tertiary"
                    size="sm"
                    label="Or pick any file"
                    onPress={() => void pickFile("any")}
                    style={{ marginTop: 6 }}
                  />
                </Pressable>
              )}

              {source === "video" && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>YouTube URL</Text>
                  <Field
                    leadingIcon="youtube"
                    value={youtubeUrl}
                    onChangeText={setYoutubeUrl}
                    placeholder="https://youtube.com/..."
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.helper}>We'll use the video's transcript.</Text>
                </View>
              )}

              {source === "web" && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>Website URL</Text>
                  <Field
                    leadingIcon="externalLink"
                    value={websiteUrl}
                    onChangeText={setWebsiteUrl}
                    placeholder="https://example.com/article"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Text style={styles.helper}>
                    We'll import the page's readable content as a source.
                  </Text>
                </View>
              )}

              {source === "topic" && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.fieldLabel}>What do you want to learn?</Text>
                  <Field
                    leadingIcon="sparklesOutline"
                    value={topic}
                    onChangeText={setTopic}
                    placeholder="e.g. The Krebs cycle"
                  />
                  <Text style={styles.helper}>
                    No source needed — AI builds a starter deck from the topic.
                  </Text>
                </View>
              )}
            </Card>

            <Card padding={16} style={{ gap: 16 }}>
              <Text style={styles.sectionTitle}>Card settings</Text>

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
                <View style={styles.focusList}>
                  {FOCUS_PRESET_OPTIONS.map((option) => {
                    const active = option.value === focusPreset;
                    return (
                      <Pressable
                        key={option.value}
                        onPress={() => setFocusPreset(option.value)}
                        style={[styles.focusOption, active && styles.focusOptionActive]}
                      >
                        <View style={styles.focusOptionText}>
                          <Text style={styles.focusOptionLabel}>{option.label}</Text>
                          <Text style={styles.focusOptionDesc}>{option.description}</Text>
                        </View>
                        {active && (
                          <Icon name="check" size={16} color={colors.brand600} />
                        )}
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </Card>

            {task && (
              <Card padding={14} style={{ gap: 10 }}>
                <View style={styles.jobHeader}>
                  <FeaturedIcon icon="sparkles" variant="brand" size="sm" />
                  <Text style={styles.jobStatus}>{taskPhaseLabel(task)}</Text>
                </View>
                <ProgressBar value={task.progress / 100} />
                <Text style={styles.backgroundHint}>
                  You can switch tabs while this runs. New cards appear under Cards.
                </Text>
              </Card>
            )}

            <Button
              variant="brand"
              size="xl"
              label={task ? "Generating in background…" : "Generate cards"}
              leadingIcon="sparkles"
              disabled={Boolean(task) || !canGenerate}
              onPress={startGeneration}
              fullWidth
            />
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
            contentContainerStyle={styles.content}
            contentInsetAdjustmentBehavior="automatic"
            ListHeaderComponent={
              <View style={styles.cardsHeader}>
                {tabSwitcher}
                {runNotice}
                <View style={styles.cardsSummary}>
                  <Text style={styles.summaryText}>
                    {cardTotal} card{cardTotal === 1 ? "" : "s"}
                  </Text>
                  <Button
                    variant="tertiary"
                    size="sm"
                    label="Add card"
                    leadingIcon="add"
                    disabled={creatingCard}
                    loading={creatingCard}
                    onPress={() => setCardTypePickerOpen(true)}
                  />
                </View>
              </View>
            }
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void loadCards(0, false, true).finally(() => setRefreshing(false));
                }}
                tintColor={colors.brand500}
              />
            }
            onEndReachedThreshold={0.3}
            onEndReached={() => {
              if (cardsLoading || loadingMore || cards.length >= cardTotal) return;
              void loadCards(cards.length, true);
            }}
            ListFooterComponent={
              loadingMore ? (
                <ActivityIndicator color={colors.brand500} style={{ marginVertical: 16 }} />
              ) : null
            }
            renderItem={({ item }) => (
              <CardListItem
                card={item}
                showDeck={false}
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
                <ActivityIndicator color={colors.brand500} style={{ marginTop: 24 }} />
              ) : (
                <Card padding={20} style={styles.empty}>
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
                </Card>
              )
            }
          />
        </>
      )}
      <DeckSelectModal
        visible={cardTypePickerOpen}
        onClose={() => setCardTypePickerOpen(false)}
        title="Add a card"
        options={[...NEW_CARD_TYPES]}
        onSelect={(opt) => void addCard(opt.id)}
      />
      {id ? (
        <DeckActionsSheet
          visible={actionsOpen}
          deck={{
            id,
            title: deckName ?? "Deck",
            cardCount: cardTotal,
            isPublished: published,
          }}
          omit={["open", "create"]}
          onClose={() => setActionsOpen(false)}
          onRenamed={(name) => setDeckName(name)}
          onDuplicated={(copy) => {
            setActionsOpen(false);
            router.replace(`/(tabs)/create/${copy.id}`);
          }}
          onDeleted={() => {
            setActionsOpen(false);
            router.replace("/(tabs)/create");
          }}
          onPublishedChange={setPublished}
        />
      ) : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { padding: 16, gap: 12, paddingBottom: 32 },
    sectionTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.1,
    },
    fieldLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginBottom: 6,
    },
    helper: {
      fontSize: 12,
      color: colors.fgQuaternary,
      fontWeight: "500",
      marginTop: 4,
    },
    textarea: {
      alignItems: "flex-start",
      minHeight: 80,
    },
    dropzone: {
      padding: 28,
      borderColor: colors.borderPrimary,
      borderWidth: 1,
      borderStyle: "dashed",
      borderRadius: radius.lg,
      backgroundColor: colors.gray50,
      alignItems: "center",
      gap: 6,
    },
    dropzoneTitle: {
      fontSize: 14,
      fontWeight: "500",
      color: colors.fgSecondary,
      marginTop: 8,
    },
    dropzoneSub: {
      fontSize: 12,
      color: colors.fgQuaternary,
    },
    jobHeader: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
    },
    jobStatus: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
      flex: 1,
    },
    backgroundHint: {
      fontSize: 12,
      color: colors.fgQuaternary,
    },
    focusList: {
      gap: 8,
    },
    focusOption: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      backgroundColor: colors.bgSurface,
    },
    focusOptionActive: {
      borderColor: colors.brand600,
      backgroundColor: colors.gray50,
    },
    focusOptionText: {
      flex: 1,
      gap: 2,
    },
    focusOptionLabel: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    focusOptionDesc: {
      fontSize: 12,
      color: colors.fgTertiary,
    },
    sourceChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    sourceChip: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 7,
      paddingHorizontal: 11,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: 999,
      backgroundColor: colors.bgSurface,
    },
    sourceChipActive: {
      borderColor: colors.brand600,
      backgroundColor: colors.brand50,
    },
    sourceChipLabel: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgTertiary,
    },
    sourceChipLabelActive: {
      color: colors.brand700,
    },
    cardsHeader: {
      gap: 12,
      paddingBottom: 4,
    },
    notice: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.brand200,
      backgroundColor: colors.brand50,
    },
    noticeText: {
      flex: 1,
      fontSize: 13,
      lineHeight: 18,
      color: colors.brand700,
    },
    noticeStrong: {
      fontWeight: "600",
    },
    cardsSummary: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      paddingHorizontal: 4,
    },
    summaryText: {
      fontSize: 14,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    empty: { alignItems: "center", gap: 4 },
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
