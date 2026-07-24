import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/ui/icon";
import { api } from "@/lib/api";
import { radius, type ThemeColors } from "@/lib/theme";
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

  const hidden = new Set(omit);
  const empty = (deck?.cardCount ?? 0) <= 0;

  function close() {
    if (busy) return;
    setRenameOpen(false);
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
            onPress: (value) => {
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
      <Pressable style={styles.backdrop} onPress={close}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle} numberOfLines={1}>
            {deck.title}
          </Text>

          {renameOpen ? (
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
                      pressed && !disabled && { opacity: 0.7 },
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
      </Pressable>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.bgOverlay,
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.bgSurface,
      borderTopLeftRadius: radius.xl3,
      borderTopRightRadius: radius.xl3,
      paddingHorizontal: 20,
      paddingTop: 12,
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
  });
}
