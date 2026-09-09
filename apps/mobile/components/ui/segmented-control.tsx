import NativeSegmentedControl from "@react-native-segmented-control/segmented-control";
import { useMemo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Option<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  accessibilityLabel?: string;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: Props<T>) {
  const { colors, colorScheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );

  if (Platform.OS === "ios") {
    return (
      <NativeSegmentedControl
        values={options.map((option) => option.label)}
        selectedIndex={selectedIndex}
        accessibilityLabel={accessibilityLabel}
        appearance={colorScheme}
        tintColor={colors.bgSurface}
        // UISegmentedControl.backgroundColor fills the view bounds as a
        // rectangle; keep it clear so only the native capsule track shows.
        backgroundColor="transparent"
        style={{ backgroundColor: "transparent" }}
        fontStyle={{ color: colors.fgSecondary, fontSize: 13 }}
        activeFontStyle={{
          color: colors.fgPrimary,
          fontSize: 13,
          fontWeight: "600",
        }}
        onChange={(event) => {
          const option = options[event.nativeEvent.selectedSegmentIndex];
          if (!option) return;
          haptics.selection();
          onChange(option.value);
        }}
      />
    );
  }

  return (
    <View
      style={styles.row}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              haptics.selection();
              onChange(option.value);
            }}
            style={[styles.cell, active && styles.cellActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      backgroundColor: colors.gray100,
      borderColor: colors.borderSecondary,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: 3,
      gap: 3,
    },
    cell: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      paddingVertical: 8,
      paddingHorizontal: 10,
      borderColor: "transparent",
      borderWidth: 1,
      borderRadius: radius.md,
    },
    cellActive: {
      backgroundColor: colors.bgSurface,
      borderColor: colors.borderSecondary,
    },
    label: {
      fontSize: 13,
      fontWeight: "600",
      color: colors.fgTertiary,
    },
    labelActive: { color: colors.fgPrimary },
  });
}
