import type { ComponentProps } from "react";
import { useMemo } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import type { Stack } from "expo-router";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** An SF Symbol name. iOS menus draw it; Android menus show text only. */
export type SfSymbolName = Extract<
  ComponentProps<typeof Stack.Toolbar.MenuAction>["icon"],
  string
>;

export type NativeMenuItem = {
  label: string;
  onPress: () => void;
  sfIcon?: SfSymbolName;
  disabled?: boolean;
  destructive?: boolean;
  /** Set for choice lists. true shows the system checkmark. */
  selected?: boolean;
};

export type NativeMenuGroup = {
  title?: string;
  items: NativeMenuItem[];
};

export type NativeMenuEntry = NativeMenuItem | NativeMenuGroup;

export function isMenuGroup(entry: NativeMenuEntry): entry is NativeMenuGroup {
  return "items" in entry;
}

/** Android stand-in for a native menu: a plain bottom sheet of rows. */
export function MenuSheet({
  visible,
  title,
  message,
  entries,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  entries: NativeMenuEntry[];
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const renderItem = (item: NativeMenuItem, index: number) => (
    <Pressable
      key={`${index}-${item.label}`}
      disabled={item.disabled}
      accessibilityRole="menuitem"
      accessibilityState={{ disabled: item.disabled, selected: item.selected }}
      onPress={() => {
        onClose();
        item.onPress();
      }}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        item.disabled && styles.rowDisabled,
      ]}
    >
      <Text
        style={[styles.rowLabel, item.destructive && { color: colors.danger }]}
        numberOfLines={2}
      >
        {item.label}
      </Text>
      {item.selected ? <Icon name="check" size={18} color={colors.accent} /> : null}
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose}>
        <View
          style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}
          onTouchEnd={(event) => event.stopPropagation()}
        >
          <Text style={styles.title} numberOfLines={2}>
            {title}
          </Text>
          {message ? <Text style={styles.message}>{message}</Text> : null}
          <ScrollView>
            {entries.map((entry, index) =>
              isMenuGroup(entry) ? (
                <View key={entry.title ?? index} style={index > 0 && styles.group}>
                  {entry.title ? <Text style={styles.groupTitle}>{entry.title}</Text> : null}
                  {entry.items.map(renderItem)}
                </View>
              ) : (
                renderItem(entry, index)
              ),
            )}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: colors.bgOverlay,
      justifyContent: "flex-end",
    },
    sheet: {
      maxHeight: "75%",
      backgroundColor: colors.bgSurface,
      borderTopLeftRadius: radius.xl4,
      borderTopRightRadius: radius.xl4,
      paddingTop: 16,
    },
    title: {
      fontSize: 17,
      lineHeight: 22,
      fontWeight: "600",
      color: colors.fgPrimary,
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    message: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      paddingHorizontal: 20,
      paddingBottom: 8,
    },
    group: {
      borderTopColor: colors.line,
      borderTopWidth: StyleSheet.hairlineWidth,
      marginTop: 4,
      paddingTop: 4,
    },
    groupTitle: {
      fontSize: 12,
      lineHeight: 16,
      fontWeight: "500",
      color: colors.fgTertiary,
      paddingHorizontal: 20,
      paddingVertical: 6,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 14,
    },
    rowPressed: { backgroundColor: colors.bgHover },
    rowDisabled: { opacity: 0.4 },
    rowLabel: {
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      color: colors.fgPrimary,
    },
  });
}
