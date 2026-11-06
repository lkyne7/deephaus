import { useMemo } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon } from "@/components/ui/icon";
import { NativeMenu } from "@/components/ui/native-menu";
import type { NativeMenuEntry } from "@/components/ui/menu-sheet";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type FilterPill<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

function PillBody({
  label,
  count,
  active,
  chevron,
}: {
  label: string;
  count?: number;
  active: boolean;
  chevron?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <View style={[styles.pill, active && styles.pillActive]}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {count != null ? <Text style={styles.count}>{count.toLocaleString()}</Text> : null}
      {chevron ? <Icon name="arrowDown" size={11} color={colors.fgTertiary} /> : null}
    </View>
  );
}

/** A pill that opens a choice menu, for filters with too many values to list. */
export function FilterMenuPill({
  label,
  active,
  entries,
}: {
  label: string;
  active: boolean;
  entries: NativeMenuEntry[];
}) {
  return (
    <NativeMenu label={label} entries={entries}>
      <PillBody label={label} active={active} chevron />
    </NativeMenu>
  );
}

/** Horizontally scrolling filter pills with counts; the selected pill is soft-filled. */
export function FilterPills<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  trailing,
  style,
}: {
  options: readonly FilterPill<T>[];
  value: T | null;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
  /** Extra pills, such as FilterMenuPill, after the options. */
  trailing?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      accessibilityLabel={accessibilityLabel}
      style={[styles.scroller, style]}
      contentContainerStyle={styles.row}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              haptics.selection();
              onChange(option.value);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={
              option.count != null ? `${option.label}, ${option.count}` : option.label
            }
          >
            <PillBody label={option.label} count={option.count} active={active} />
          </Pressable>
        );
      })}
      {trailing}
    </ScrollView>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroller: { flexGrow: 0 },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 20,
    },
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      height: 36,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSurface,
    },
    pillActive: { backgroundColor: colors.bgActive },
    label: {
      maxWidth: 180,
      fontSize: 15,
      lineHeight: 20,
      color: colors.fgPrimary,
    },
    count: {
      fontSize: 15,
      lineHeight: 20,
      color: colors.fgTertiary,
    },
  });
}
