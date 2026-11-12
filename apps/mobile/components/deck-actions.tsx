import {
  DEFAULT_REVIEW_ORDER,
  parsePartialReviewOrder,
  resolveReviewOrder,
  type ReviewOrderSettings,
} from "@deephaus/shared";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { ReviewOrderControls } from "@/components/review-order-controls";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import type { NativeMenuEntry, NativeMenuItem } from "@/components/ui/menu-sheet";
import { NativeSheet } from "@/components/ui/native-sheet";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { api } from "@/lib/api";
import { useBackgroundTasks } from "@/lib/background-tasks-context";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";
import { openDeck, openSection } from "@/lib/sections";

export type DeckActionsDeck = {
  id: string;
  title: string;
  cardCount?: number;
  isPublished?: boolean;
  /** Added from Community: someone else's deck, so it can't be published. */
  isCommunity?: boolean;
  /** Set where the screen knows it; the Pause / Resume action is offered only then. */
  paused?: boolean;
};

export type DeckActionKey =
  | "open"
  | "study"
  | "create"
  | "browse"
  | "exam"
  | "rename"
  | "settings"
  | "pause"
  | "duplicate"
  | "publish"
  | "export"
  | "delete";

type DeckAction = NativeMenuItem & { key: DeckActionKey };

type Options = {
  omit?: DeckActionKey[];
  onRenamed?: (deck: DeckActionsDeck, name: string) => void;
  onDuplicated?: (deck: { id: string; name: string }) => void;
  onDeleted?: (deckId: string) => void;
  onPublishedChange?: (deck: DeckActionsDeck, published: boolean) => void;
  onPausedChange?: (deck: DeckActionsDeck, paused: boolean) => void;
};

/**
 * Deck lifecycle actions shared across Home, Decks and Create. `entriesFor`
 * feeds a native menu; `sheets` holds the two real forms (rename, settings)
 * and must be rendered by the screen.
 */
export function useDeckActions({
  omit = [],
  onRenamed,
  onDuplicated,
  onDeleted,
  onPublishedChange,
  onPausedChange,
}: Options = {}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { startAnkiExport } = useBackgroundTasks();
  const [busy, setBusy] = useState<DeckActionKey | null>(null);
  const [renaming, setRenaming] = useState<DeckActionsDeck | null>(null);
  const [deckReviewOrder, setDeckReviewOrder] = useState<ReviewOrderSettings>(DEFAULT_REVIEW_ORDER);
  const [settingsDeck, setSettingsDeck] = useState<DeckActionsDeck | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [useGlobalFsrs, setUseGlobalFsrs] = useState(true);
  const [deckRetentionPct, setDeckRetentionPct] = useState("90");
  const [deckNewPerDay, setDeckNewPerDay] = useState("10");
  const [globalFsrs, setGlobalFsrs] = useState<{ retentionPct: number; newPerDay: number } | null>(
    null,
  );

  async function runRename(deck: DeckActionsDeck, nextName: string) {
    const next = nextName.trim();
    if (!next || next === deck.title) return;
    setBusy("rename");
    try {
      const updated = await api.updateDeck(deck.id, { deck_name: next, name: next });
      onRenamed?.(deck, updated.deck_name || updated.name);
    } catch (e) {
      Alert.alert("Rename failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  function openSettings(deck: DeckActionsDeck) {
    setSettingsDeck(deck);
    setSettingsLoading(true);
    setSettingsError(null);
    void (async () => {
      try {
        const [project, globals] = await Promise.all([
          api.getDeck(deck.id),
          api.getFsrsSettings(),
        ]);
        const settings = (project.settings ?? {}) as {
          desiredRetention?: number;
          newCardsPerDay?: number;
          useGlobalFsrsSettings?: boolean;
        };
        // The deck's own review options over the study defaults.
        setDeckReviewOrder(
          resolveReviewOrder(
            parsePartialReviewOrder(project.settings),
            { ...DEFAULT_REVIEW_ORDER, ...parsePartialReviewOrder(globals.reviewOrder) },
            false,
          ),
        );
        setGlobalFsrs({
          retentionPct: Math.round(globals.desiredRetention * 100),
          newPerDay: globals.newCardsPerDay,
        });
        setUseGlobalFsrs(Boolean(settings.useGlobalFsrsSettings));
        setDeckRetentionPct(
          String(Math.round((settings.desiredRetention ?? globals.desiredRetention) * 100)),
        );
        setDeckNewPerDay(String(settings.newCardsPerDay ?? globals.newCardsPerDay));
      } catch (e) {
        setSettingsError(e instanceof Error ? e.message : "Could not load deck settings.");
      } finally {
        setSettingsLoading(false);
      }
    })();
  }

  async function saveSettings() {
    if (!settingsDeck) return;
    const retention = Math.max(70, Math.min(97, Number(deckRetentionPct) || 90));
    const newPerDay = Math.max(0, Math.min(200, Number(deckNewPerDay) || 0));
    setBusy("settings");
    try {
      await api.updateDeck(settingsDeck.id, {
        settings: useGlobalFsrs
          ? { useGlobalFsrsSettings: true }
          : {
              useGlobalFsrsSettings: false,
              desiredRetention: retention / 100,
              newCardsPerDay: newPerDay,
              ...deckReviewOrder,
            },
      });
      haptics.success();
      setSettingsDeck(null);
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  async function duplicate(deck: DeckActionsDeck) {
    setBusy("duplicate");
    try {
      const copy = await api.duplicateDeck(deck.id);
      const name = copy.deck_name || copy.name;
      onDuplicated?.({ id: copy.id, name });
      Alert.alert("Duplicated", `Created “${name}”.`);
    } catch (e) {
      Alert.alert("Duplicate failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  /** A paused deck keeps its cards but drops out of today's totals and the combined review. */
  async function togglePaused(deck: DeckActionsDeck) {
    const next = !deck.paused;
    setBusy("pause");
    try {
      await api.updateDeck(deck.id, { settings: { paused: next } });
      haptics.selection();
      onPausedChange?.(deck, next);
    } catch (e) {
      Alert.alert(
        next ? "Could not pause deck" : "Could not resume deck",
        e instanceof Error ? e.message : "Unknown error",
      );
    } finally {
      setBusy(null);
    }
  }

  async function togglePublished(deck: DeckActionsDeck) {
    setBusy("publish");
    try {
      if (deck.isPublished) {
        await api.unpublishDeck(deck.id);
        onPublishedChange?.(deck, false);
        Alert.alert("Unpublished", "Deck is no longer on the community.");
      } else {
        await api.publishDeck({ project_id: deck.id });
        onPublishedChange?.(deck, true);
        Alert.alert("Published", "Deck is now on the community.");
      }
    } catch (e) {
      Alert.alert("Publish failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete(deck: DeckActionsDeck) {
    haptics.warning();
    Alert.alert(
      "Delete deck?",
      deck.isPublished
        ? `“${deck.title}” will be permanently deleted, including its Community listing. This cannot be undone.`
        : `“${deck.title}” and all of its cards will be permanently deleted. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBusy("delete");
              try {
                await api.deleteDeck(deck.id);
                onDeleted?.(deck.id);
              } catch (e) {
                Alert.alert("Delete failed", e instanceof Error ? e.message : "Unknown error");
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }

  function entriesFor(deck: DeckActionsDeck): NativeMenuEntry[] {
    const hidden = new Set(omit);
    const empty = (deck.cardCount ?? 0) <= 0;
    const locked = busy != null;
    const group = (items: DeckAction[]) => ({
      items: items.filter((item) => !hidden.has(item.key)),
    });

    const groups = [
      group([
        {
          key: "open",
          label: "Open deck",
          sfIcon: "folder",
          onPress: () => openDeck(deck.id),
        },
        {
          key: "study",
          label: "Study",
          sfIcon: "book",
          disabled: empty,
          onPress: () => router.push(`/study/${deck.id}`),
        },
        {
          key: "create",
          label: "Add cards",
          sfIcon: "plus.circle",
          onPress: () =>
            openSection("home", { deck: deck.id, deckName: deck.title }),
        },
        {
          key: "browse",
          label: "Browse cards",
          sfIcon: "square.stack.3d.up",
          onPress: () => router.push({ pathname: "/cards", params: { deck: deck.id } }),
        },
        {
          key: "exam",
          label: "Add exam",
          sfIcon: "calendar.badge.plus",
          disabled: empty,
          // The new exam opens with this deck already chosen.
          onPress: () => router.push({ pathname: "/exams/create", params: { deck: deck.id } }),
        },
      ]),
      group([
        {
          key: "rename",
          label: "Rename",
          sfIcon: "pencil",
          disabled: locked,
          onPress: () => setRenaming(deck),
        },
        {
          key: "settings",
          label: "Deck settings",
          sfIcon: "slider.horizontal.3",
          disabled: locked,
          onPress: () => openSettings(deck),
        },
        ...(deck.paused == null
          ? []
          : [
              {
                key: "pause" as const,
                label: deck.paused ? "Resume deck" : "Pause deck",
                sfIcon: (deck.paused ? "play.circle" : "pause.circle") as NativeMenuItem["sfIcon"],
                disabled: locked,
                onPress: () => void togglePaused(deck),
              },
            ]),
        {
          key: "duplicate",
          label: "Duplicate",
          sfIcon: "doc.on.doc",
          disabled: locked,
          onPress: () => void duplicate(deck),
        },
      ]),
      group([
        ...(deck.isCommunity
          ? []
          : [
              {
                key: "publish" as const,
                label: deck.isPublished ? "Unpublish from Community" : "Publish to Community",
                sfIcon: "globe" as NativeMenuItem["sfIcon"],
                disabled: locked || (empty && !deck.isPublished),
                onPress: () => void togglePublished(deck),
              },
            ]),
        {
          key: "export",
          label: "Export .apkg",
          sfIcon: "square.and.arrow.down",
          disabled: empty,
          // Packaged in the background (streamed for large decks); the share
          // sheet opens once the file has downloaded.
          onPress: () => startAnkiExport(deck.id, deck.title),
        },
      ]),
      group([
        {
          key: "delete",
          label: "Delete deck",
          sfIcon: "trash",
          destructive: true,
          disabled: locked,
          onPress: () => confirmDelete(deck),
        },
      ]),
    ];
    return groups.filter((entry) => entry.items.length > 0);
  }

  const saving = busy === "settings";
  const sheets = (
    <>
      <TextPromptModal
        visible={renaming != null}
        title="Rename deck"
        placeholder="Deck name"
        initialValue={renaming?.title ?? ""}
        onSubmit={(value) => {
          if (renaming) void runRename(renaming, value);
        }}
        onClose={() => setRenaming(null)}
      />
      <NativeSheet
        visible={settingsDeck != null}
        onClose={() => setSettingsDeck(null)}
        title="Deck settings"
        detents={[{ height: 420 }, "large"]}
        dismissDisabled={saving}
        trailing={
          <Button
            size="md"
            variant="brand"
            label="Save"
            loading={saving}
            disabled={settingsLoading || settingsError != null}
            onPress={() => void saveSettings()}
          />
        }
        leading={
          <Button
            variant="secondary"
            size="md"
            iconOnly
            leadingIcon="close"
            label="Cancel"
            disabled={saving}
            onPress={() => setSettingsDeck(null)}
          />
        }
      >
        <ScrollView
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <Text style={styles.deckName} numberOfLines={1}>
            {settingsDeck?.title}
          </Text>
          {settingsLoading ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: 16 }} />
          ) : settingsError ? (
            <Text style={styles.error}>{settingsError}</Text>
          ) : (
            <View style={styles.group}>
              <View style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={styles.rowTitle}>Use global defaults</Text>
                  {globalFsrs ? (
                    <Text style={styles.rowHint}>
                      {globalFsrs.retentionPct}% retention · {globalFsrs.newPerDay} new/day
                    </Text>
                  ) : null}
                </View>
                <Switch
                  value={useGlobalFsrs}
                  onValueChange={(next) => {
                    haptics.selection();
                    setUseGlobalFsrs(next);
                  }}
                  trackColor={{ true: colors.accent }}
                />
              </View>
              {useGlobalFsrs ? null : (
                <>
                  <View style={[styles.row, styles.rowLine]}>
                    <Text style={[styles.rowTitle, styles.rowCopy]}>Desired retention (70–97%)</Text>
                    <Field
                      value={deckRetentionPct}
                      onChangeText={(t) => setDeckRetentionPct(t.replace(/[^\d]/g, ""))}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      placeholder="90"
                      containerStyle={styles.numberField}
                    />
                  </View>
                  <View style={[styles.row, styles.rowLine]}>
                    <Text style={[styles.rowTitle, styles.rowCopy]}>New cards per day</Text>
                    <Field
                      value={deckNewPerDay}
                      onChangeText={(t) => setDeckNewPerDay(t.replace(/[^\d]/g, ""))}
                      keyboardType="number-pad"
                      returnKeyType="done"
                      placeholder="10"
                      containerStyle={styles.numberField}
                    />
                  </View>
                  <ReviewOrderControls value={deckReviewOrder} onChange={setDeckReviewOrder} />
                </>
              )}
            </View>
          )}
        </ScrollView>
      </NativeSheet>
    </>
  );

  return { entriesFor, sheets };
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24, gap: 10 },
    deckName: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      textAlign: "center",
    },
    group: {
      backgroundColor: colors.bgSurface,
      borderRadius: radius.xl3,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    rowLine: {
      borderTopColor: colors.line,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    rowCopy: { flex: 1, minWidth: 0 },
    rowTitle: { fontSize: 16, lineHeight: 22, color: colors.fgPrimary },
    rowHint: { fontSize: 13, lineHeight: 18, color: colors.fgTertiary, marginTop: 1 },
    numberField: { width: 84 },
    error: { fontSize: 14, lineHeight: 20, color: colors.danger, textAlign: "center" },
  });
}
