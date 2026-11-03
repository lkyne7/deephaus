import { useMemo } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import type { ScreenHeaderAction, ScreenHeaderMenu } from "@/components/ui/screen-header";
import { haptics } from "@/lib/haptics";
import { offlineData } from "@/lib/offline-data";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type CardBatchAction = "suspend" | "unsuspend" | "delete";

/** Confirm deletes, then apply the action. Resolves true when cards changed. */
export async function runCardBatchAction(
  action: CardBatchAction,
  cardIds: string[],
): Promise<boolean> {
  if (cardIds.length === 0) return false;
  if (action === "delete") {
    haptics.warning();
    const count = cardIds.length;
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        count === 1 ? "Delete card?" : `Delete ${count} cards?`,
        "This can't be undone.",
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: "Delete", style: "destructive", onPress: () => resolve(true) },
        ],
      );
    });
    if (!confirmed) return false;
  }
  haptics.medium();
  try {
    await offlineData.browseBatch({ action, card_ids: cardIds });
    return true;
  } catch (e) {
    Alert.alert("Could not update cards", e instanceof Error ? e.message : "Unknown error");
    return false;
  }
}

/**
 * Header actions while cards are selected. On iOS the bulk actions live in a
 * header menu: anything pinned to the bottom of a screen (including a native
 * bottom toolbar) renders underneath the floating tab bar. Android shows them
 * in the inline CardBatchToolbar instead, so only the clear button is added.
 */
export function cardSelectionHeaderActions(
  count: number,
  onAction: (action: CardBatchAction) => void,
  onClear: () => void,
): Array<ScreenHeaderAction | ScreenHeaderMenu> {
  const clear: ScreenHeaderAction = {
    icon: "close",
    sfIcon: "xmark",
    label: "Clear selection",
    onPress: onClear,
  };
  if (Platform.OS !== "ios") return [clear];
  const cards = `${count} card${count === 1 ? "" : "s"}`;
  return [
    {
      type: "menu",
      icon: "more",
      sfIcon: "ellipsis.circle",
      label: `Actions for ${cards}`,
      items: [
        { label: `Suspend ${cards}`, sfIcon: "pause.circle", onPress: () => onAction("suspend") },
        { label: `Unsuspend ${cards}`, sfIcon: "play.circle", onPress: () => onAction("unsuspend") },
        {
          label: `Delete ${cards}`,
          sfIcon: "trash",
          destructive: true,
          onPress: () => onAction("delete"),
        },
      ],
    },
    clear,
  ];
}

/** Inline bulk-action bar for Android; iOS uses cardSelectionHeaderActions. */
export function CardBatchToolbar({
  count,
  onAction,
}: {
  count: number;
  onAction: (action: CardBatchAction) => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (count === 0 || Platform.OS === "ios") return null;

  return (
    <View style={styles.batchBar}>
      <Text style={styles.batchCount}>{count} selected</Text>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <Button variant="secondary" size="sm" label="Suspend" onPress={() => onAction("suspend")} />
        <Button variant="secondary" size="sm" label="Unsuspend" onPress={() => onAction("unsuspend")} />
        <Button variant="danger" size="sm" label="Delete" onPress={() => onAction("delete")} />
      </View>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    batchBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 16,
      paddingTop: 12,
    },
    batchCount: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgSecondary,
    },
  });
}
