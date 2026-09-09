import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Icon, type IconName } from "@/components/ui/icon";
import { api } from "@/lib/api";
import { haptics } from "@/lib/haptics";
import { layout, radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type DeckActionsDeck = {
  id: string;
  title: string;
  cardCount?: number;
  isPublished?: boolean;
};

type ActionKey =
  | "open"
  | "study"
  | "create"
  | "browse"
  | "rename"
  | "settings"
  | "duplicate"
  | "publish"
  | "export"
  | "delete";

type Props = {
  visible: boolean;
  deck: DeckActionsDeck | null;
  onClose: () => void;
  omit?: ActionKey[];
  onRenamed?: (name: string) => void;
  onDuplicated?: (deck: { id: string; name: string }) => void;
  onDeleted?: (deckId: string) => void;
  onPublishedChange?: (published: boolean) => void;
};

/**
 * Native action sheet for deck lifecycle actions shared across Dashboard,
 * Study, and Create.
 */
export function DeckActionsSheet({
  visible,
  deck,
  onClose,
  omit = [],
  onRenamed,
  onDuplicated,
  onDeleted,
  onPublishedChange,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [busy, setBusy] = useState<ActionKey | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [useGlobalFsrs, setUseGlobalFsrs] = useState(true);
  const [deckRetentionPct, setDeckRetentionPct] = useState("90");
  const [deckNewPerDay, setDeckNewPerDay] = useState("10");
  const [globalFsrs, setGlobalFsrs] = useState<{ retentionPct: number; newPerDay: number } | null>(
    null,
  );

  const hidden = new Set(omit);
  const empty = (deck?.cardCount ?? 0) <= 0;

  function close() {
    if (busy) return;
    setRenameOpen(false);
    setSettingsOpen(false);
    onClose();
  }

  async function runRename(nextName: string) {
    if (!deck) return;
    const next = nextName.trim();
    if (!next || next === deck.title) {
      setRenameOpen(false);
      return;
    }
    setBusy("rename");
    try {
      const updated = await api.updateDeck(deck.id, { deck_name: next, name: next });
      const name = updated.deck_name || updated.name;
      onRenamed?.(name);
      setRenameOpen(false);
      onClose();
    } catch (e) {
      Alert.alert("Rename failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  function handleRename() {
    if (!deck) return;
    if (Platform.OS === "ios" && typeof Alert.prompt === "function") {
      onClose();
      Alert.prompt(
        "Rename deck",
        undefined,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Save",
            onPress: (value?: string) => {
              void runRename(value ?? "");
            },
          },
        ],
        "plain-text",
        deck.title,
      );
      return;
    }
    setRenameValue(deck.title);
    setRenameOpen(true);
  }

  function handleOpenSettings() {
    if (!deck) return;
    setSettingsOpen(true);
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

  async function handleSaveSettings() {
    if (!deck) return;
    const retention = Math.max(70, Math.min(97, Number(deckRetentionPct) || 90));
    const newPerDay = Math.max(0, Math.min(200, Number(deckNewPerDay) || 0));
    setBusy("settings");
    try {
      await api.updateDeck(deck.id, {
        settings: useGlobalFsrs
          ? { useGlobalFsrsSettings: true }
          : {
              useGlobalFsrsSettings: false,
              desiredRetention: retention / 100,
              newCardsPerDay: newPerDay,
            },
      });
      haptics.success();
      setSettingsOpen(false);
      onClose();
    } catch (e) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  async function handleDuplicate() {
    if (!deck) return;
    setBusy("duplicate");
    try {
      const copy = await api.duplicateDeck(deck.id);
      const name = copy.deck_name || copy.name;
      onDuplicated?.({ id: copy.id, name });
      onClose();
      Alert.alert("Duplicated", `Created “${name}”.`);
    } catch (e) {
      Alert.alert("Duplicate failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  async function handlePublish() {
    if (!deck) return;
    setBusy("publish");
    try {
      if (deck.isPublished) {
        await api.unpublishDeck(deck.id);
        onPublishedChange?.(false);
        Alert.alert("Unpublished", "Deck is no longer on the community.");
      } else {
        await api.publishDeck({ project_id: deck.id });
        onPublishedChange?.(true);
        Alert.alert("Published", "Deck is now on the community.");
      }
      onClose();
    } catch (e) {
      Alert.alert("Publish failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  async function handleExport() {
    if (!deck) return;
    setBusy("export");
    try {
      const blob = await api.exportDeck(deck.id);
      const reader = new FileReader();
      await new Promise<void>((resolve, reject) => {
        reader.onloadend = async () => {
          try {
            const base64 = (reader.result as string).split(",")[1];
            if (!base64) throw new Error("Could not read export file.");
            const safe = deck.title.replace(/[^a-z0-9-_]+/gi, "-") || "deck";
            const path = `${FileSystem.cacheDirectory}${safe}.apkg`;
            await FileSystem.writeAsStringAsync(path, base64, {
              encoding: FileSystem.EncodingType.Base64,
            });
            if (await Sharing.isAvailableAsync()) {
              await Sharing.shareAsync(path, {
                mimeType: "application/octet-stream",
                dialogTitle: "Export Anki deck",
              });
            } else {
              Alert.alert("Exported", `Saved to ${path}`);
            }
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        reader.onerror = () => reject(new Error("Could not read export file."));
        reader.readAsDataURL(blob);
      });
      onClose();
    } catch (e) {
      Alert.alert("Export failed", e instanceof Error ? e.message : "Unknown error");
    } finally {
      setBusy(null);
    }
  }

  function handleDelete() {
    if (!deck) return;
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
                onClose();
              } catch (e) {
                Alert.alert(
                  "Delete failed",
                  e instanceof Error ? e.message : "Unknown error",
                );
              } finally {
                setBusy(null);
              }
            })();
          },
        },
      ],
    );
  }

  if (!deck) return null;

  const actions: Array<{
    key: ActionKey;
    label: string;
    icon: IconName;
    danger?: boolean;
    disabled?: boolean;
    onPress: () => void;
  }> = [
    {
      key: "open",
      label: "Open deck",
      icon: "folder",
      onPress: () => {
        onClose();
        router.push(`/(tabs)/create/${deck.id}`);
      },
    },
    {
      key: "study",
      label: "Study",
      icon: "book",
      disabled: empty,
      onPress: () => {
        onClose();
        router.push(`/(tabs)/study/${deck.id}`);
      },
    },
    {
      key: "create",
      label: "Create cards",
      icon: "plusCircle",
      onPress: () => {
        onClose();
        router.push(`/(tabs)/create/${deck.id}`);
      },
    },
    {
      key: "browse",
      label: "Browse cards",
      icon: "layers",
      onPress: () => {
        onClose();
        router.push({ pathname: "/(tabs)/browse", params: { deck: deck.id } });
      },
    },
    {
      key: "rename",
      label: "Rename",
      icon: "pencil",
      onPress: handleRename,
    },
    {
      key: "settings",
      label: "Deck settings",
      icon: "equalizer",
      onPress: handleOpenSettings,
    },
    {
      key: "duplicate",
      label: "Duplicate",
      icon: "copy",
      onPress: () => void handleDuplicate(),
    },
    {
      key: "publish",
      label: deck.isPublished ? "Unpublish from Community" : "Publish to Community",
      icon: "earth",
      disabled: empty && !deck.isPublished,
      onPress: () => void handlePublish(),
    },
    {
      key: "export",
      label: "Export .apkg",
      icon: "download",
      disabled: empty,
      onPress: () => void handleExport(),
    },
    {
      key: "delete",
      label: "Delete deck",
      icon: "trash",
      danger: true,
      onPress: handleDelete,
    },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <KeyboardAvoidingView
        style={styles.keyboardRoot}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
      <Pressable style={styles.backdrop} onPress={close}>
        <GlassSurface
          fallbackColor={colors.bgSurface}
          glassEffectStyle="regular"
          style={[
            styles.sheet,
            { marginBottom: Math.max(insets.bottom, layout.floatingGlassInset) },
          ]}
        >
          <Pressable
            style={styles.sheetContent}
            onPress={(e) => e.stopPropagation()}
          >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {deck.title}
          </Text>

          {settingsOpen ? (
            <ScrollView
              style={styles.settingsScroll}
              contentContainerStyle={styles.renameBox}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
            >
              <Text style={styles.renameLabel}>FSRS study settings</Text>
              {settingsLoading ? (
                <ActivityIndicator color={colors.brand600} style={{ marginVertical: 16 }} />
              ) : settingsError ? (
                <Text style={styles.settingsError}>{settingsError}</Text>
              ) : (
                <>
                  <View style={styles.settingsToggleRow}>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.settingsToggleLabel}>Use global defaults</Text>
                      {globalFsrs ? (
                        <Text style={styles.settingsToggleHint}>
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
                      trackColor={{ true: colors.brand500 }}
                    />
                  </View>
                  {!useGlobalFsrs && (
                    <>
                      <View>
                        <Text style={styles.renameLabel}>Desired retention (70–97%)</Text>
                        <TextInput
                          value={deckRetentionPct}
                          onChangeText={(t) => setDeckRetentionPct(t.replace(/[^\d]/g, ""))}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          style={styles.renameInput}
                          placeholder="90"
                          placeholderTextColor={colors.fgQuaternary}
                        />
                      </View>
                      <View>
                        <Text style={styles.renameLabel}>New cards per day</Text>
                        <TextInput
                          value={deckNewPerDay}
                          onChangeText={(t) => setDeckNewPerDay(t.replace(/[^\d]/g, ""))}
                          keyboardType="number-pad"
                          returnKeyType="done"
                          style={styles.renameInput}
                          placeholder="10"
                          placeholderTextColor={colors.fgQuaternary}
                        />
                      </View>
                    </>
                  )}
                </>
              )}
              <View style={styles.renameActions}>
                <Pressable
                  onPress={() => setSettingsOpen(false)}
                  style={styles.renameBtn}
                  disabled={busy != null}
                >
                  <Text style={styles.renameBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void handleSaveSettings()}
                  style={styles.renameBtn}
                  disabled={busy != null || settingsLoading || settingsError != null}
                >
                  <Text style={[styles.renameBtnText, styles.renameSave]}>
                    {busy === "settings" ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            </ScrollView>
          ) : renameOpen ? (
            <View style={styles.renameBox}>
              <Text style={styles.renameLabel}>Rename deck</Text>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                autoFocus
                style={styles.renameInput}
                placeholder="Deck name"
                placeholderTextColor={colors.fgQuaternary}
              />
              <View style={styles.renameActions}>
                <Pressable
                  onPress={() => setRenameOpen(false)}
                  style={styles.renameBtn}
                  disabled={busy != null}
                >
                  <Text style={styles.renameBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={() => void runRename(renameValue)}
                  style={styles.renameBtn}
                  disabled={busy != null}
                >
                  <Text style={[styles.renameBtnText, styles.renameSave]}>
                    {busy === "rename" ? "Saving…" : "Save"}
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : (
            actions
              .filter((action) => !hidden.has(action.key))
              .map((action) => {
                const disabled = Boolean(action.disabled) || busy != null;
                return (
                  <Pressable
                    key={action.key}
                    onPress={action.onPress}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.actionRow,
                      pressed && !disabled && styles.actionRowPressed,
                      disabled && { opacity: 0.4 },
                      action.danger && styles.dangerRow,
                    ]}
                  >
                    {busy === action.key ? (
                      <ActivityIndicator size="small" color={colors.brand600} />
                    ) : (
                      <Icon
                        name={action.icon}
                        size={20}
                        color={action.danger ? colors.gradeAgain : colors.fgSecondary}
                      />
                    )}
                    <Text
                      style={[
                        styles.actionText,
                        action.danger ? styles.dangerText : null,
                      ]}
                    >
                      {action.label}
                    </Text>
                  </Pressable>
                );
              })
          )}

          <Pressable onPress={close} style={styles.cancelBtn} disabled={busy != null}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
          </Pressable>
        </GlassSurface>
      </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    keyboardRoot: { flex: 1 },
    backdrop: {
      flex: 1,
      backgroundColor: colors.bgOverlay,
      justifyContent: "flex-end",
    },
    settingsScroll: { maxHeight: 360 },
    sheet: {
      marginHorizontal: layout.floatingGlassInset,
      borderRadius: layout.floatingGlassRadius,
      overflow: "hidden",
    },
    sheetContent: {
      paddingHorizontal: 20,
      paddingTop: 12,
      paddingBottom: 16,
      gap: 2,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.gray300,
      marginBottom: 8,
    },
    sheetTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginBottom: 8,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 4,
    },
    actionText: {
      fontSize: 16,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    actionRowPressed: {
      backgroundColor: colors.brand50,
      borderRadius: radius.xl2,
    },
    dangerRow: {
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
      marginTop: 4,
    },
    dangerText: {
      color: colors.gradeAgain,
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 14,
      marginTop: 4,
    },
    cancelText: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgSecondary,
    },
    renameBox: {
      gap: 10,
      paddingVertical: 8,
    },
    renameLabel: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    renameInput: {
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      color: colors.fgPrimary,
      backgroundColor: colors.bgCanvas,
    },
    renameActions: {
      flexDirection: "row",
      justifyContent: "flex-end",
      gap: 16,
    },
    renameBtn: {
      paddingVertical: 6,
    },
    renameBtnText: {
      fontSize: 16,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    renameSave: {
      color: colors.brand600,
      fontWeight: "600",
    },
    settingsToggleRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
    },
    settingsToggleLabel: {
      fontSize: 15,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    settingsToggleHint: {
      fontSize: 12,
      color: colors.fgQuaternary,
      marginTop: 2,
    },
    settingsError: {
      fontSize: 13,
      color: colors.gradeAgain,
    },
  });
}
