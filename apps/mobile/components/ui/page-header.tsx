import { useMemo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { layout, radius, type ThemeColors } from "@/lib/theme";

type Props = {
  title: string;
  left?: ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  style?: StyleProp<ViewStyle>;
};

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    safe: {
      backgroundColor: colors.bgSurface,
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: 1,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      height: layout.appHeaderRowHeight,
      paddingHorizontal: 16,
    },
    left: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      minWidth: 0,
    },
    right: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    title: {
      flex: 1,
      fontSize: 20,
      lineHeight: 26,
      fontWeight: "600",
      color: colors.fgPrimary,
      letterSpacing: -0.2,
    },
    backBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
      marginLeft: -8,
    },
    headerIconBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.lg,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}

export function PageHeader({ title, left, right, onBack, style }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <SafeAreaView edges={["top"]} style={[styles.safe, style]}>
      <View style={styles.row}>
        <View style={styles.left}>
          {onBack ? (
            <Pressable onPress={onBack} style={styles.backBtn} hitSlop={8}>
              <Icon name="arrowLeft" size={22} color={colors.fgPrimary} />
            </Pressable>
          ) : (
            left
          )}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.right}>{right}</View>
      </View>
    </SafeAreaView>
  );
}

export function PageHeaderIconButton({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      onPress={onPress}
      style={styles.headerIconBtn}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Icon name={icon} size={18} color={colors.fgSecondary} />
    </Pressable>
  );
}
