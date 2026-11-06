import { router, useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Platform,
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useDeckActions } from "@/components/deck-actions";
import { BadgePill } from "@/components/ui/badge-pill";
import { BrandMark } from "@/components/ui/brand-mark";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import { Field } from "@/components/ui/input";
import { DeckLogo } from "@/components/ui/deck-logo";
import { Icon } from "@/components/ui/icon";
import { NativeContextMenu, NativeMenu } from "@/components/ui/native-menu";
import { ScreenHeader } from "@/components/ui/screen-header";
import { api } from "@/lib/api";
import { KeyboardScreen } from "@/components/ui/keyboard-screen";
import { useBackgroundTasks } from "@/lib/background-tasks-context";
import { deckDisplayName } from "@/lib/deck-name";
import { serifFont } from "@/lib/fonts";
import { offlineData } from "@/lib/offline-data";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import type { Project } from "@deephaus/shared";

export default function CreateScreen() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [cardCounts, setCardCounts] = useState<Record<string, number>>({});
  const [deckName, setDeckName] = useState("");
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { getTaskForProject, recentRuns } = useBackgroundTasks();
  const loadedOnceRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [items, stats] = await Promise.all([
        offlineData.listProjects(),
        offlineData.getDashboardStats().catch(() => null),
      ]);
      setProjects(items);
      setCardCounts(
        Object.fromEntries(
          (stats?.per_deck ?? []).map((deck) => [deck.deck_id, deck.total]),
        ),
      );
    } catch {
      setProjects([]);
      setCardCounts({});
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const deckActions = useDeckActions({
    omit: ["open", "create"],
    onRenamed: (deck, name) =>
      setProjects((prev) =>
        prev.map((p) => (p.id === deck.id ? { ...p, name, deck_name: name } : p)),
      ),
    onDuplicated: () => {
      void load();
    },
    onDeleted: (deckId) => setProjects((prev) => prev.filter((p) => p.id !== deckId)),
  });

  // Card counts change after generation and edits elsewhere; refresh on return.
  useFocusEffect(
    useCallback(() => {
      void load(loadedOnceRef.current);
      loadedOnceRef.current = true;
    }, [load]),
  );

  async function createDeck() {
    const title = deckName.trim();
    if (!title) return;
    setCreating(true);
    try {
      const project = await api.createProject({
        name: title,
        deck_name: title,
      });
      setDeckName("");
      router.push(`/(tabs)/create/${project.id}`);
    } catch (e) {
      Alert.alert(
        "Could not create deck",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setCreating(false);
    }
  }

  // The serif hero is for a first run only; with decks it is a plain sans prompt.
  const firstRun = !loading && projects.length === 0;

  return (
    <View style={styles.root}>
      <ScreenHeader
        // The prompt below is the title on iOS, where the bar floats over it.
        title={Platform.OS === "ios" ? "" : "Create"}
        actions={[
          {
            icon: "upload",
            sfIcon: "square.and.arrow.down",
            label: "Import from Anki or Quizlet",
            onPress: () => router.push("/(tabs)/create/import"),
          },
        ]}
      />
      <KeyboardScreen>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(true);
            }}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.greetingRow}>
          <BrandMark size={firstRun ? 30 : 24} />
          <Text style={firstRun ? styles.hero : styles.prompt}>
            What are we studying today?
          </Text>
        </View>

        <Card raised style={styles.composer}>
          <Field
            value={deckName}
            onChangeText={setDeckName}
            placeholder="Name your deck, e.g. Cardiology"
            accessibilityLabel="Deck name"
            containerStyle={styles.composerField}
          />
          <View style={styles.composerRow}>
            <Pressable
              onPress={() => router.push("/(tabs)/create/import")}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Import from Anki or Quizlet"
              style={({ pressed }) => [styles.composerPlus, pressed && styles.rowPressed]}
            >
              <Icon name="add" size={18} color={colors.fgSecondary} />
            </Pressable>
            <View style={styles.composerTool}>
              <Icon name="folder" size={15} color={colors.fgTertiary} />
              <Text style={styles.composerToolLabel} numberOfLines={1}>
                New deck
              </Text>
            </View>
            <Pressable
              onPress={() => void createDeck()}
              disabled={!deckName.trim() || creating}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Create deck"
              accessibilityState={{ disabled: !deckName.trim() || creating, busy: creating }}
              style={({ pressed }) => [
                styles.send,
                !deckName.trim() && styles.sendOff,
                pressed && styles.rowPressed,
              ]}
            >
              {creating ? (
                <ActivityIndicator color={colors.actionBrandFg} size="small" />
              ) : (
                <Icon
                  name="arrowRight"
                  size={17}
                  color={colors.actionBrandFg}
                  style={styles.sendIcon}
                />
              )}
            </Pressable>
          </View>
        </Card>

        <View style={styles.list}>
          <Text style={styles.sectionTitle}>Your decks</Text>
          {loading ? (
            <ActivityIndicator color={colors.accent} style={{ marginTop: 12 }} />
          ) : projects.length === 0 ? (
            <View style={styles.empty}>
              <FeaturedIcon icon="folder" variant="gray" size="lg" />
              <Text style={styles.emptyTitle}>No decks yet</Text>
              <Text style={styles.emptyBody}>
                Create a deck to start generating cards from your notes, PDFs, or
                YouTube videos.
              </Text>
            </View>
          ) : (
            projects.map((project) => {
              const title = deckDisplayName(project.deck_name || project.name);
              const cards = cardCounts[project.id] ?? 0;
              const generating = Boolean(getTaskForProject(project.id));
              const run = recentRuns[project.id];
              const newCount = run && !run.badgesSeen ? run.cardsAdded : 0;
              const menu = deckActions.entriesFor({
                id: project.id,
                title,
                cardCount: cards,
              });
              return (
                <NativeContextMenu key={project.id} label={title} entries={menu}>
                  {({ onLongPress }) => (
                    <View style={styles.deckRow}>
                      <Pressable
                        onPress={() => router.push(`/(tabs)/create/${project.id}`)}
                        onLongPress={onLongPress}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.deckMain, pressed && styles.rowPressed]}
                      >
                        <DeckLogo />
                        <View style={styles.deckText}>
                          <Text style={styles.projectName} numberOfLines={2}>
                            {title}
                          </Text>
                          <View style={styles.deckMeta}>
                            <Text style={styles.deckCount}>
                              {`${cards} card${cards === 1 ? "" : "s"}`}
                            </Text>
                            {generating ? (
                              <BadgePill label="Generating…" tone="brand" />
                            ) : newCount > 0 ? (
                              <BadgePill label={`${newCount} new`} tone="brand" />
                            ) : null}
                          </View>
                        </View>
                      </Pressable>
                      <NativeMenu label={`Actions for ${title}`} entries={menu}>
                        <View style={styles.moreBtn}>
                          <Icon name="more" size={18} color={colors.fgTertiary} />
                        </View>
                      </NativeMenu>
                    </View>
                  )}
                </NativeContextMenu>
              );
            })
          )}
        </View>
      </ScrollView>
      </KeyboardScreen>
      {deckActions.sheets}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bgCanvas },
    content: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 32, gap: 20 },
    greetingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
    hero: {
      ...serifFont(),
      flex: 1,
      fontSize: 30,
      lineHeight: 36,
      letterSpacing: -0.45,
      color: colors.fgPrimary,
    },
    prompt: {
      flex: 1,
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
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
    list: { gap: 10 },
    sectionTitle: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
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
    deckRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingLeft: 14,
      paddingRight: 10,
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
    },
    deckMain: {
      flex: 1,
      minWidth: 0,
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingVertical: 12,
    },
    rowPressed: { opacity: 0.6 },
    deckText: { flex: 1, minWidth: 0, gap: 3 },
    projectName: {
      fontSize: 16,
      lineHeight: 22,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    deckMeta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
    deckCount: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary },
    moreBtn: {
      width: 36,
      height: 36,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
