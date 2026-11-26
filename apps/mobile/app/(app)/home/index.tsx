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
import Animated, {
  useAnimatedKeyboard,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BackgroundTasksBanner } from "@/components/background-tasks-banner";
import { CardOptionsSheet } from "@/components/create/card-options-sheet";
import { CreateComposer, type ComposerHandle } from "@/components/create/create-composer";
import {
  HOME_MOTION,
  HomeOverview,
  isCaughtUp,
  useHomeStats,
} from "@/components/home/home-overview";
import { preloadPreview } from "@/components/home/up-next";
import { OfflineNotice } from "@/components/offline-notice";
import { BrandMark } from "@/components/ui/brand-mark";
import { Icon, type IconName } from "@/components/ui/icon";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { ScreenHeader } from "@/components/ui/screen-header";
import { api } from "@/lib/api";
import { useBackgroundTasks, type BackgroundTask } from "@/lib/background-tasks-context";
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
import { offlineData } from "@/lib/offline-data";
import { recentDecks } from "@/lib/recent-decks";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { useOnline } from "@/lib/use-online";

type PickedFile = { uri: string; name: string; size?: number; mimeType?: string };
type Deck = { id: string; title: string };
/** What a run started here was made from, so a failed run can be tried again. */
type SentRun = { text: string; deck: Deck | null; file: PickedFile | null };

/**
 * Space between Home's suggestions and the composer. iOS insets the scroll
 * content a little more than the header's height, so this is more than the
 * content's own bottom padding.
 */
const HOME_BOTTOM_GAP = 26;
/**
 * Home's frame: on iOS a plain view, since the composer rides the keyboard
 * itself; elsewhere the keyboard-avoiding screen (Android resizes anyway).
 */
function KeyboardContainer({ children }: { children: React.ReactNode }) {
  if (Platform.OS === "ios") return <View style={{ flex: 1 }}>{children}</View>;
  return <KeyboardScreen>{children}</KeyboardScreen>;
}

/** About one line of the deck menu on a phone. */
const MENU_DECK_NAME_CHARS = 22;
const MAX_MENU_DECKS = 8;
// A system picker can't open while a sheet is still closing.
/** Lets a pop-up menu finish closing before something else is presented. */
const MENU_CLOSE_MS = 300;

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
 * Home, like Claude's new chat: Up next above a docked composer. Sending keeps
 * Home on screen: the cards are made in the background as one quiet row under
 * the card, which becomes the card ("Learn your 15 new cards") once they're
 * ready, so studying and making carry on side by side.
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
  const [file, setFile] = useState<PickedFile | null>(null);
  const [deck, setDeck] = useState<Deck | null>(null);
  const [decks, setDecks] = useState<Deck[] | null>(null);
  const [options, setOptions] = useState<CreateOptions>(DEFAULT_CREATE_OPTIONS);
  const [sending, setSending] = useState(false);
  const [namingDeck, setNamingDeck] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [focused, setFocused] = useState(true);
  // The composer has the cursor: Home clears the page for writing, as it does
  // once there's text in it.
  const [composerFocused, setComposerFocused] = useState(false);
  // Runs sent from here, by task: what they were made from, for Try again.
  const sentRuns = useRef(new Map<string, SentRun>());
  // Runs that have just finished, held as a done row while Home reloads its
  // numbers, then handed over to the Up next card.
  const [finishing, setFinishing] = useState<ReadonlySet<string>>(new Set());
  // Decks made here, by id, for while the deck list and stats catch up.
  const [madeDecks, setMadeDecks] = useState<ReadonlyMap<string, string>>(new Map());

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

  // A run sent from here that finishes while Home is on screen (or before it's
  // back) taps once, reloads the numbers that make it the Up next card, then
  // leaves the task list. The composer goes on adding to that deck.
  const { reload } = home;
  useEffect(() => {
    if (!focused) return;
    for (const task of tasks) {
      if (task.kind !== "generation" || task.status !== "ready") continue;
      if (!sentRuns.current.has(task.id) || finishing.has(task.id)) continue;
      sentRuns.current.delete(task.id);
      if ((task.cardsAdded ?? 0) > 0) haptics.success();
      setFinishing((current) => new Set(current).add(task.id));
      if (task.projectId && task.jobId) preloadPreview(task.projectId, task.jobId);
      if (task.projectId) {
        const projectId = task.projectId;
        const title = task.deckName ?? "Deck";
        setDeck((current) => current ?? { id: projectId, title });
        setMadeDecks((current) => new Map(current).set(projectId, title));
      }
      void reload().finally(() => {
        dismissTask(task.id);
        setFinishing((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      });
    }
  }, [focused, tasks, finishing, dismissTask, reload]);

  function updateOptions(next: CreateOptions) {
    setOptions(next);
    saveCreateOptions(next);
  }

  function startOver() {
    setDeck(null);
    setDraft("");
    setFile(null);
  }

  // Puts a failed run's text (and file) back in the composer, aimed at the
  // same deck, ready to send again. A run sent elsewhere is only cleared.
  function retryTask(task: BackgroundTask) {
    const sent = sentRuns.current.get(task.id);
    sentRuns.current.delete(task.id);
    dismissTask(task.id);
    if (!sent) return;
    setDraft(sent.text);
    setFile(sent.file);
    setDeck(
      task.projectId ? { id: task.projectId, title: task.deckName ?? sent.deck?.title ?? "Deck" } : sent.deck,
    );
    setTimeout(() => composerRef.current?.focus(), 250);
  }

  function dismissFailed(task: BackgroundTask) {
    sentRuns.current.delete(task.id);
    dismissTask(task.id);
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
    // A run opened from elsewhere (params.task) is already on Home, under Up next.
    if (params.fresh) {
      // New cards opens straight into writing, once the sidebar has closed.
      startOver();
      setTimeout(() => composerRef.current?.focus(), 350);
    } else if (params.deck) {
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

  function afterMenuCloses(action: () => void) {
    setTimeout(action, MENU_CLOSE_MS);
  }

  async function writeCard(newDeckName?: string) {
    setNamingDeck(false);
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
      router.push(`/home/card/${card.id}?blank=1`);
    } catch (error) {
      Alert.alert(
        "Could not create card",
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }

  const kind = file ? null : classifyCreateInput(draft);
  const deckBusy = deck ? Boolean(getTaskForProject(deck.id)) : false;
  // Send is ready from the first letter, as in Claude's composer. A topic
  // still needs MIN_TOPIC_CHARS (the API's minimum), so a send before then
  // only taps back and leaves the text to finish.
  const canSend = online && !deckBusy && Boolean(file || draft.trim());

  async function send() {
    if (!canSend || sending) return;
    if (!file && !kind) {
      haptics.light();
      return;
    }
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

      sentRuns.current.set(taskId, { text, deck, file });
      Keyboard.dismiss();
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

  // Everything the composer's + can add. It means the same thing everywhere.
  const addEntries: NativeMenuEntry[] = [
    {
      items: [
        {
          label: "Choose a file",
          sfIcon: "doc",
          onPress: () => afterMenuCloses(() => void pickFile()),
        },
      ],
    },
    {
      items: [
        {
          label: "Write a card by hand",
          sfIcon: "pencil",
          onPress: () =>
            deck ? void writeCard() : afterMenuCloses(() => setNamingDeck(true)),
        },
        {
          label: "Import from Anki or Quizlet",
          sfIcon: "square.and.arrow.down",
          onPress: () => router.push("/home/import"),
        },
      ],
    },
  ];

  // Most recent decks first (the sidebar's order), so a deck just made or
  // studied is in the menu, and the chosen deck is always there, ticked.
  const menuDecks = useMemo(() => {
    const recent = recentDecks(home.projects, home.stats).map(({ id, title }) => ({ id, title }));
    const listed = new Set(recent.map((item) => item.id));
    const all = [...recent, ...(decks ?? []).filter((item) => !listed.has(item.id))];
    const top = all.slice(0, MAX_MENU_DECKS);
    if (deck && !top.some((item) => item.id === deck.id)) top.unshift(deck);
    return top;
  }, [deck, decks, home.projects, home.stats]);

  const deckEntries: NativeMenuEntry[] = [
    {
      items: [
        { label: "New deck", sfIcon: "plus", selected: !deck, onPress: () => setDeck(null) },
      ],
    },
    {
      title: "Your decks",
      items: menuDecks.map((item) => ({
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
    : deck
      ? `Add more to ${truncateTitle(deck.title, MENU_DECK_NAME_CHARS)}`
      : isCaughtUp(home.stats, home.exams)
        ? "Anything new to learn?"
        : "Make cards from a topic, notes or a link";

  const firstRun = decks !== null && decks.length === 0;
  // Room under the composer for the home indicator. On iOS it stays put and
  // the composer rides up on the keyboard from there (see `lift`). Android
  // resizes the window itself.
  const bottomRoom = Platform.OS === "ios" || !keyboardOpen ? insets.bottom : 0;

  // As in Claude's app, the composer rides on top of the keyboard, frame by
  // frame through its whole motion (and back down with an interactive
  // dismissal), 8 points clear of it; the page slides up with it as one piece,
  // so Up next stays just above the composer and the welcome fades as it
  // passes under the bar. The keyboard's height comes from Reanimated on the UI
  // thread, so nothing is laid out again while it moves.
  const keyboard = useAnimatedKeyboard();
  const bottomInset = insets.bottom;
  const lift = useDerivedValue(() =>
    Platform.OS === "ios" ? Math.max(0, keyboard.height.value - bottomInset) : 0,
  );
  const pageShift = useDerivedValue(() => -lift.value);
  const liftStyle = useAnimatedStyle(() => ({ transform: [{ translateY: -lift.value }] }));

  // Home fills what the floating header leaves of the scroll view, which the
  // keyboard no longer resizes; the composer gaining lines does.
  const fillHeight = useSharedValue(0);
  const fillTarget = useRef(0);
  const onScrollLayout = useCallback(
    (height: number) => {
      const fill = Math.max(0, height - (Platform.OS === "ios" ? headerHeight : 0) - HOME_BOTTOM_GAP);
      if (fill <= 0 || Math.abs(fill - fillTarget.current) < 1) return;
      const first = fillTarget.current === 0;
      fillTarget.current = fill;
      fillHeight.value = first ? fill : withTiming(fill, HOME_MOTION);
    },
    [fillHeight, headerHeight],
  );

  const homeFillStyle = useAnimatedStyle(() => ({ minHeight: fillHeight.value }));

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
        title={Platform.OS === "ios" ? "" : "Home"}
        // Search lives here only; the sidebar keeps just New cards.
        actions={[
          {
            icon: "search",
            sfIcon: "magnifyingglass",
            label: "Search",
            onPress: () => router.push("/search"),
          },
        ]}
      />
      <KeyboardContainer>
        <Animated.View style={[styles.scroll, liftStyle]}>
          <ScrollView
            style={styles.scroll}
            onLayout={(event) => onScrollLayout(event.nativeEvent.layout.height)}
            contentContainerStyle={[
              styles.content,
              firstRun ? styles.contentStart : styles.contentHome,
            ]}
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            refreshControl={
              !firstRun ? (
                <RefreshControl
                  refreshing={home.refreshing}
                  onRefresh={home.refresh}
                  tintColor={colors.accent}
                />
              ) : undefined
            }
          >
            {!firstRun ? (
              <Animated.View style={[styles.homeFill, homeFillStyle]}>
                <HomeOverview
                  home={home}
                  shift={pageShift}
                  writing={composerFocused || draft.trim().length > 0 || file != null}
                  finishing={finishing}
                  madeDecks={madeDecks}
                  onRetryTask={retryTask}
                  onDismissTask={dismissFailed}
                />
              </Animated.View>
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
        </Animated.View>

        <Animated.View style={[styles.dock, { paddingBottom: bottomRoom + 8 }, liftStyle]}>
          {!online ? <OfflineNotice feature="AI card generation" /> : null}
          {/* Cards being made show under Up next, so the banner leaves them out. */}
          <BackgroundTasksBanner hideKinds={["generation"]} />
          <CreateComposer
            ref={composerRef}
            value={draft}
            onChangeText={setDraft}
            onFocus={() => setComposerFocused(true)}
            onBlur={() => setComposerFocused(false)}
            placeholder={placeholder}
            hint={hint}
            attachmentName={file?.name}
            onRemoveAttachment={() => setFile(null)}
            addEntries={addEntries}
            deckLabel={deck?.title ?? "New deck"}
            deckEntries={deckEntries}
            onOptions={() => setOptionsOpen(true)}
            cardOptions={{ value: options, onChange: updateOptions }}
            onSend={() => void send()}
            canSend={canSend}
            sending={sending}
          />
        </Animated.View>
      </KeyboardContainer>

      <TextPromptModal
        visible={namingDeck}
        title="Name your deck"
        placeholder="e.g. Cardiology"
        submitLabel="Write a card"
        accessibilityLabel="Deck name"
        autoCapitalize="words"
        onSubmit={(name) => {
          if (name.trim()) void writeCard(name.trim());
        }}
        onClose={() => setNamingDeck(false)}
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
    homeFill: { flexGrow: 1 },
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
    dock: { gap: 8, paddingHorizontal: 12 },
    pressed: { opacity: 0.6 },
  });
}
