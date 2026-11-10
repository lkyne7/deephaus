import type { BrowseCardRow } from "@deephaus/api-client";
import { MAX_CUSTOM_INSTRUCTIONS_CHARS, type Project } from "@deephaus/shared";
import * as DocumentPicker from "expo-document-picker";
import { router, useFocusEffect, useLocalSearchParams, useNavigation } from "expo-router";
import { DrawerActions, useHeaderHeight } from "expo-router/react-navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Keyboard,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackgroundTasksBanner } from "@/components/background-tasks-banner";
import { AddSourceSheet } from "@/components/create/add-source-sheet";
import { CardOptionsSheet } from "@/components/create/card-options-sheet";
import { CreateComposer, type ComposerHandle } from "@/components/create/create-composer";
import { HomeOverview, isCaughtUp, useHomeStats } from "@/components/home/home-overview";
import { OfflineNotice } from "@/components/offline-notice";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import { ProgressBar } from "@/components/ui/progress-bar";
import { newCardsAction, ScreenHeader } from "@/components/ui/screen-header";
import { api } from "@/lib/api";
import {
  generationSourceLabel,
  taskPhaseLabel,
  useBackgroundTasks,
  type BackgroundTask,
} from "@/lib/background-tasks-context";
import { plainCardText } from "@/lib/card-preview";
import {
  classifyCreateInput,
  createInputLabel,
  deckTitleFromFile,
  deckTitleFromInput,
  normalizeUrl,
  truncateTitle,
} from "@/lib/create-input";
import {
  DEFAULT_CREATE_OPTIONS,
  generationSettings,
  loadCreateOptions,
  saveCreateOptions,
  type CreateOptions,
} from "@/lib/create-options";
import { deckDisplayName } from "@/lib/deck-name";
import { serifFont } from "@/lib/fonts";
import { haptics } from "@/lib/haptics";
import { loadJobCards } from "@/lib/job-cards";
import { offlineData } from "@/lib/offline-data";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

type PickedFile = { uri: string; name: string; size?: number; mimeType?: string };
type Deck = { id: string; title: string };
/** A run the user has seen finish. Its task is gone, so its banner is too. */
type FinishedRun = {
  deckId: string;
  deckName: string;
  jobId?: string;
  cardsAdded: number;
  sourceLabel: string;
};

/** About one line of the deck menu on a phone. */
const MENU_DECK_NAME_CHARS = 22;
const MAX_MENU_DECKS = 8;
const PREVIEW_CARDS = 2;
// A system picker can't open while a sheet is still closing.
const SHEET_CLOSE_MS = 400;

function useKeyboardOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow",
      () => setOpen(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide",
      () => setOpen(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

/**
 * Home, like Claude's new chat: today's review above a docked composer. Sending
 * turns the screen into that run's thread; New cards in the bar starts fresh.
 */
export default function HomeScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const online = useOnline();
  const home = useHomeStats();
  const params = useLocalSearchParams<{
    task?: string;
    fresh?: string;
    deck?: string;
    deckName?: string;
  }>();
  const navigation = useNavigation();
  const keyboardOpen = useKeyboardOpen();
  const headerHeight = useHeaderHeight();
  const [scrollHeight, setScrollHeight] = useState(0);
  const {
    tasks,
    dismissTask,
    getTaskForProject,
    startGenerationFromText,
    startGenerationFromFile,
    startGenerationFromYoutube,
    startGenerationFromWebsite,
    startGenerationFromTopic,
  } = useBackgroundTasks();

  const composerRef = useRef<ComposerHandle>(null);
  const [draft, setDraft] = useState("");
  const [composerFocused, setComposerFocused] = useState(false);
  const [file, setFile] = useState<PickedFile | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [options, setOptions] = useState<CreateOptions>(DEFAULT_CREATE_OPTIONS);
  const [sending, setSending] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // The run on screen. Everything about it comes from its persisted task.
  const [runTaskId, setRunTaskId] = useState<string | null>(null);
  const [finishedRun, setFinishedRun] = useState<FinishedRun | null>(null);
  const [focused, setFocused] = useState(true);
  const [preview, setPreview] = useState<BrowseCardRow[]>([]);
  // Cards from the run still in the deck, which review can reduce.
  const [remaining, setRemaining] = useState<number | null>(null);
  const remainingRef = useRef<number | null>(null);
  const lastDraftRef = useRef("");

  const run = runTaskId ? tasks.find((task) => task.id === runTaskId) : undefined;
  const running = run?.status === "running";
  const failed = run?.status === "failed";
  const runDeckName = finishedRun?.deckName ?? run?.deckName ?? "your deck";

  useEffect(() => {
    void loadCreateOptions().then(setOptions);
  }, []);

  // Deck menu and first-run state follow changes made on other tabs.
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      void offlineData
        .listProjects()
        .then((items: Project[]) =>
          setDecks(
            items.map((item) => ({
              id: item.id,
              title: deckDisplayName(item.deck_name || item.name),
            })),
          ),
        )
        .catch(() => setDecks((current) => current ?? []));
      return () => setFocused(false);
    }, []),
  );

  // A dismissed task leaves nothing to show, so return to a blank composer.
  useEffect(() => {
    if (runTaskId && !run) setRunTaskId(null);
  }, [runTaskId, run]);

  // Seeing a run finish here replaces its banner, and the composer then adds to
  // the same deck. A run that ends on another tab keeps its banner until return.
  useEffect(() => {
    if (!focused || run?.status !== "ready" || !run.projectId) return;
    const deckName = run.deckName ?? "your deck";
    setFinishedRun({
      deckId: run.projectId,
      deckName,
      jobId: run.jobId,
      cardsAdded: run.cardsAdded ?? 0,
      sourceLabel: generationSourceLabel(run),
    });
    setDeck({ id: run.projectId, title: deckName });
    setRunTaskId(null);
    dismissTask(run.id);
  }, [focused, run, dismissTask]);

  // Reloads on return from review, which may have removed some or all of them.
  useEffect(() => {
    if (!finishedRun?.jobId) {
      setPreview([]);
      setRemaining(null);
      remainingRef.current = null;
      return;
    }
    if (!focused) return;
    let current = true;
    void loadJobCards(finishedRun.deckId, finishedRun.jobId, PREVIEW_CARDS)
      .then((result) => {
        if (!current) return;
        setPreview(result.cards);
        setRemaining(result.ids.length);
        if (remainingRef.current && result.ids.length === 0) {
          setFinishedRun(null);
          setDeck(null);
        }
        remainingRef.current = result.ids.length;
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [finishedRun, focused]);

  function updateOptions(next: CreateOptions) {
    setOptions(next);
    saveCreateOptions(next);
  }

  function startOver() {
    if (failed && run) dismissTask(run.id);
    setRunTaskId(null);
    setFinishedRun(null);
    setDeck(null);
    setDraft("");
    setFile(null);
  }

  function retry() {
    const failedRun = run;
    setRunTaskId(null);
    if (failedRun) dismissTask(failedRun.id);
    if (failedRun?.projectId) {
      setDeck({ id: failedRun.projectId, title: failedRun.deckName ?? "Deck" });
    }
    setDraft(lastDraftRef.current);
  }

  // The sidebar and deck pages link here: reopen a run, start fresh, or aim
  // the composer at a deck. Each link is handled once, then cleared.
  useEffect(() => {
    if (!params.task && !params.fresh && !params.deck) return;
    // These links arrive from the sidebar, which closes itself before
    // navigating. Close it here too: on a device the navigation could land
    // while the close was still settling and leave the sidebar open over Home.
    // The action bubbles up from Home's stack to the drawer.
    navigation.dispatch(DrawerActions.closeDrawer());
    if (params.task) {
      setFinishedRun(null);
      setRunTaskId(params.task);
    } else if (params.fresh) {
      // New cards opens straight into writing, once the sidebar has closed.
      startOver();
      setTimeout(() => composerRef.current?.focus(), 350);
    } else if (params.deck) {
      setRunTaskId(null);
      setFinishedRun(null);
      setDeck({ id: params.deck, title: params.deckName ?? "Deck" });
      setTimeout(() => composerRef.current?.focus(), 350);
    }
    router.setParams({ task: undefined, fresh: undefined, deck: undefined, deckName: undefined });
    // startOver only reads state it resets.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.task, params.fresh, params.deck, params.deckName]);

  async function pickFile() {
    const picked = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      copyToCacheDirectory: true,
    });
    if (picked.canceled || !picked.assets[0]) return;
    const asset = picked.assets[0];
    setFile({
      uri: asset.uri,
      name: asset.name,
      size: asset.size,
      mimeType: asset.mimeType,
    });
  }

  function afterSheetCloses(action: () => void) {
    setAddOpen(false);
    setTimeout(action, SHEET_CLOSE_MS);
  }

  async function writeCard(newDeckName?: string) {
    setAddOpen(false);
    try {
      let deckId = deck?.id;
      if (!deckId) {
        const name = newDeckName ?? "New deck";
        const project = await api.createProject({ name, deck_name: name });
        deckId = project.id;
        setDeck({ id: project.id, title: name });
      }
      const card = await offlineData.createCard({
        project_id: deckId,
        type: "basic",
        append: false,
      });
      router.push(`/home/card/${card.id}`);
    } catch (error) {
      Alert.alert(
        "Could not create card",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  const kind = file ? null : classifyCreateInput(draft);
  const deckBusy = deck ? Boolean(getTaskForProject(deck.id)) : false;
  const canSend = online && !deckBusy && Boolean(file || kind);

  async function send() {
    if (!canSend || sending) return;
    haptics.medium();
    const text = draft.trim();
    setSending(true);
    try {
      const title = file
        ? deckTitleFromFile(file.name)
        : deckTitleFromInput(kind ?? "topic", text);
      let target = deck;
      if (!target) {
        const project = await api.createProject({ name: title, deck_name: title });
        target = { id: project.id, title };
      }
      const meta = { deckName: target.title };
      const instructions = file ? text.slice(0, MAX_CUSTOM_INSTRUCTIONS_CHARS) : undefined;
      const settings = generationSettings(options, instructions);

      let taskId: string;
      if (file) {
        taskId = startGenerationFromFile(
          target.id,
          file.uri,
          file.name,
          /\.pdf$/i.test(file.name) ? "pdf" : "any",
          settings,
          file.size,
          file.mimeType,
          meta,
        );
      } else if (kind === "youtube") {
        taskId = startGenerationFromYoutube(target.id, normalizeUrl(text), settings, meta);
      } else if (kind === "website") {
        taskId = startGenerationFromWebsite(target.id, normalizeUrl(text), settings, meta);
      } else if (kind === "notes") {
        taskId = startGenerationFromText(target.id, text, settings, meta);
      } else {
        taskId = startGenerationFromTopic(target.id, text, settings, meta);
      }

      // Sending moves on from whatever finished or failed before.
      if (failed && run) dismissTask(run.id);
      setFinishedRun(null);
      lastDraftRef.current = text;
      Keyboard.dismiss();
      setRunTaskId(taskId);
      setDraft("");
      setFile(null);
    } catch (error) {
      Alert.alert(
        "Could not start",
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setSending(false);
    }
  }

  // Tapping a generation task elsewhere on this screen opens it here.
  const openTaskHere = useCallback((task: BackgroundTask) => {
    if (task.kind !== "generation") return false;
    setRunTaskId(task.id);
    return true;
  }, []);

  const deckEntries: NativeMenuEntry[] = [
    {
      items: [
        { label: "New deck", sfIcon: "plus", selected: !deck, onPress: () => setDeck(null) },
      ],
    },
    {
      title: "Your decks",
      items: (decks ?? []).slice(0, MAX_MENU_DECKS).map((item) => ({
        // iOS menus wrap long titles onto several lines; keep each deck to one.
        label: truncateTitle(item.title, MENU_DECK_NAME_CHARS),
        selected: deck?.id === item.id,
        onPress: () => setDeck(item),
      })),
    },
  ];

  const hint = file
    ? null
    : deckBusy
      ? "Already making cards for this deck"
      : kind
        ? createInputLabel(kind)
        : null;
  const placeholder = file
    ? "Anything to focus on? (optional)"
    : finishedRun
      ? `Add more to ${runDeckName}`
      : isCaughtUp(home.stats, home.exams)
        ? "Anything new to learn?"
        : "Make cards from a topic, notes or a link";

  const reviewCount = remaining ?? finishedRun?.cardsAdded ?? 0;
  const firstRun = decks !== null && decks.length === 0;
  const idle = !run && !finishedRun;
  // Writing in the composer turns Home into the chat: the review card steps
  // aside until the composer is empty and let go again.
  const composing = idle && (composerFocused || draft.trim().length > 0 || file != null);
  // The keyboard-avoiding padding takes over from the home indicator inset
  // while the keyboard is open.
  const bottomRoom = keyboardOpen ? 0 : insets.bottom;

  const startRow = (icon: IconName, label: string, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.startRow, pressed && styles.pressed]}
    >
      <Icon name={icon} size={20} color={colors.fgTertiary} />
      <Text style={styles.startRowLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        sidebar
        // The greeting is the title on iOS, where the bar floats over it.
        title={idle ? (Platform.OS === "ios" ? "" : "Home") : runDeckName}
        // Search lives here only; the sidebar keeps just New cards.
        actions={
          idle
            ? [
                {
                  icon: "search",
                  sfIcon: "magnifyingglass",
                  label: "Search",
                  onPress: () => router.push("/search"),
                },
              ]
            : [{ ...newCardsAction, onPress: startOver }]
        }
      />
      <KeyboardScreen>
        <ScrollView
          style={styles.scroll}
          onLayout={(event) => setScrollHeight(event.nativeEvent.layout.height)}
          contentContainerStyle={[
            styles.content,
            idle && firstRun && styles.contentStart,
            // The review card sits 8 points above the composer, the same width.
            // iOS insets the content by the floating header, so fill only what's
            // left below it or the card would slide under the composer.
            idle &&
              !firstRun && [
                styles.contentHome,
                { minHeight: Math.max(0, scrollHeight - (Platform.OS === "ios" ? headerHeight : 0)) },
              ],
          ]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            idle && !firstRun ? (
              <RefreshControl
                refreshing={home.refreshing}
                onRefresh={home.refresh}
                tintColor={colors.accent}
              />
            ) : undefined
          }
        >
          {run || finishedRun ? (
            <>
              <View style={styles.mine}>
                <Text style={styles.mineText} numberOfLines={3}>
                  {finishedRun?.sourceLabel ?? (run ? generationSourceLabel(run) : "")}
                </Text>
              </View>

              {run && running ? (
                <View style={styles.status}>
                  <Text style={styles.reply}>{taskPhaseLabel(run)}</Text>
                  <ProgressBar value={Math.min(1, Math.max(0, run.progress / 100))} />
                  <Text style={styles.helper}>
                    You can leave this screen. New cards go straight to {runDeckName}, and
                    we'll tell you when they're ready.
                  </Text>
                  <Button
                    variant="tertiary"
                    size="sm"
                    label="Start something else"
                    onPress={startOver}
                  />
                </View>
              ) : null}

              {finishedRun ? (
                <View style={styles.status}>
                  <Text style={styles.reply}>
                    {finishedRun.cardsAdded > 0
                      ? `${finishedRun.cardsAdded} card${finishedRun.cardsAdded === 1 ? "" : "s"} added to ${runDeckName}.`
                      : `No new cards for ${runDeckName}.`}
                  </Text>
                  {finishedRun.cardsAdded > 0 ? (
                    <>
                      <View style={styles.group}>
                        {preview.map((card, index) => (
                          <View
                            key={card.id}
                            style={[styles.cardRow, index > 0 && styles.groupLine]}
                          >
                            <Text style={styles.cardFront} numberOfLines={3}>
                              {plainCardText(
                                card.type === "basic" ? card.front : card.cloze_text,
                              )}
                            </Text>
                            {card.type === "basic" && card.back ? (
                              <Text style={styles.cardBack} numberOfLines={2}>
                                {plainCardText(card.back)}
                              </Text>
                            ) : null}
                          </View>
                        ))}
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: "/home/review",
                              params: {
                                deck: finishedRun.deckId,
                                job: finishedRun.jobId,
                                name: runDeckName,
                              },
                            })
                          }
                          accessibilityRole="button"
                          style={({ pressed }) => [
                            styles.reviewRow,
                            preview.length > 0 && styles.groupLine,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={styles.reviewLabel}>
                            {reviewCount === 1 ? "Review card" : `Review all ${reviewCount}`}
                          </Text>
                          <Icon name="arrowRightSmall" size={16} color={colors.fgTertiary} />
                        </Pressable>
                      </View>
                      <Button
                        size="lg"
                        label={`Study ${runDeckName}`}
                        fullWidth
                        onPress={() => router.push(`/study/${finishedRun.deckId}`)}
                      />
                    </>
                  ) : null}
                </View>
              ) : null}

              {run && failed ? (
                <View style={styles.status}>
                  <Text style={styles.reply}>That didn't work.</Text>
                  <Text style={styles.helper}>{taskPhaseLabel(run)}</Text>
                  <Button label="Try again" fullWidth onPress={retry} />
                </View>
              ) : null}
            </>
          ) : !firstRun ? (
            <HomeOverview home={home} composing={composing} />
          ) : (
            <>
              <View style={styles.greeting}>
                <BrandMark size={34} />
                <Text style={styles.hero}>What are we studying today?</Text>
                <Text style={styles.intro}>
                  Give DeepHaus a topic, your notes, a link or a file, and it makes the
                  flashcards.
                </Text>
              </View>
              <View>
                {startRow("download", "Bring decks from Anki or Quizlet", () =>
                  router.push("/home/import"),
                )}
                {startRow("community", "Browse decks from the community", () =>
                  router.navigate("/community"),
                )}
              </View>
            </>
          )}
        </ScrollView>

        {running ? null : (
          <View style={[styles.dock, { paddingBottom: bottomRoom + 8 }]}>
            {!online ? <OfflineNotice feature="AI card generation" /> : null}
            <BackgroundTasksBanner
              excludeTaskId={runTaskId}
              onOpenTask={openTaskHere}
            />
            <CreateComposer
              ref={composerRef}
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              hint={hint}
              attachmentName={file?.name}
              onRemoveAttachment={() => setFile(null)}
              onAdd={() => setAddOpen(true)}
              deckLabel={deck?.title ?? "New deck"}
              deckEntries={deckEntries}
              onOptions={() => setOptionsOpen(true)}
              cardOptions={{ value: options, onChange: updateOptions }}
              onSend={() => void send()}
              onFocus={() => setComposerFocused(true)}
              onBlur={() => setComposerFocused(false)}
              canSend={canSend}
              sending={sending}
            />
          </View>
        )}
      </KeyboardScreen>

      <AddSourceSheet
        visible={addOpen}
        onClose={() => setAddOpen(false)}
        onFile={() => afterSheetCloses(() => void pickFile())}
        onPaste={() => afterSheetCloses(() => composerRef.current?.focus())}
        onImport={() => afterSheetCloses(() => router.push("/home/import"))}
        onWriteCard={(name) => void writeCard(name)}
        hasDeck={Boolean(deck)}
      />
      <CardOptionsSheet
        visible={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        options={options}
        onChange={updateOptions}
      />
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    scroll: { flex: 1 },
    content: { flexGrow: 1, gap: 16, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16 },
    contentStart: { justifyContent: "flex-end" },
    contentHome: { flexGrow: 0, paddingHorizontal: 12, paddingTop: 0, paddingBottom: 8 },
    greeting: { gap: 14 },
    hero: {
      ...serifFont(),
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.45,
      color: colors.fgPrimary,
    },
    intro: { fontSize: 15, lineHeight: 20, color: colors.fgSecondary },
    startRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      borderBottomColor: colors.line,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    startRowLabel: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 20, color: colors.fgPrimary },
    mine: {
      alignSelf: "flex-end",
      maxWidth: "85%",
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.xl4,
      backgroundColor: colors.bgSunken,
    },
    mineText: { fontSize: 15, lineHeight: 20, fontWeight: "500", color: colors.fgPrimary },
    status: { gap: 12 },
    reply: { ...serifFont(), fontSize: 21, lineHeight: 28, color: colors.fgPrimary },
    helper: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    group: {
      borderRadius: radius.xl4,
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    groupLine: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
    cardRow: { gap: 2, paddingHorizontal: 14, paddingVertical: 12 },
    cardFront: { ...serifFont(), fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    cardBack: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    reviewRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      minHeight: 48,
      paddingHorizontal: 14,
    },
    reviewLabel: { fontSize: 15, lineHeight: 20, fontWeight: "500", color: colors.accent },
    dock: { gap: 8, paddingHorizontal: 12 },
    pressed: { opacity: 0.6 },
  });
}
