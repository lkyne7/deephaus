import { Pressable, StyleSheet } from "react-native";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

export type DashboardSearchButtonProps = {
  onPress: () => void;
};

export function DashboardSearchButtonFallback({
  onPress,
}: DashboardSearchButtonProps) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Search"
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}
    >
      <Icon name="search" size={18} color={colors.fgSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radius.lg,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  pressed: {
    opacity: 0.7,
  },
});
