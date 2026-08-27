import { useMemo, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { GlassSurface, liquidGlassAvailable } from "@/components/ui/glass-surface";
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
      backgroundColor: "transparent",
      borderBottomColor: colors.borderSecondary,
      borderBottomWidth: liquidGlassAvailable ? 0 : 1,
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
      marginLeft: -6,
    },
    headerIconBtn: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      overflow: "hidden",
    },
    headerIconBtnPressable: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    headerIconBtnPressed: {
      opacity: 0.72,
      transform: [{ scale: 0.94 }],
    },
  });
}

function HeaderGlassButton({
  icon,
  label,
  onPress,
  disabled,
  loading,
  style,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <GlassSurface
      fallbackColor={colors.actionSecondaryBg}
      glassEffectStyle="clear"
      interactive
      style={[styles.headerIconBtn, style]}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        style={({ pressed }) => [
          styles.headerIconBtnPressable,
          pressed && styles.headerIconBtnPressed,
        ]}
        hitSlop={6}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: disabled || loading }}
      >
        {loading ? (
          <ActivityIndicator size="small" color={colors.fgSecondary} />
        ) : (
          <Icon name={icon} size={20} color={colors.fgSecondary} />
        )}
      </Pressable>
    </GlassSurface>
  );
}

export function PageHeader({ title, left, right, onBack, style }: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <GlassSurface
      fallbackColor={colors.bgSurface}
      glassEffectStyle="regular"
      style={[styles.safe, { paddingTop: insets.top }, style]}
    >
      <View style={styles.row}>
        <View style={styles.left}>
          {onBack ? (
            <HeaderGlassButton
              icon="arrowLeft"
              label="Back"
              onPress={onBack}
              style={styles.backBtn}
            />
          ) : (
            left
          )}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <View style={styles.right}>{right}</View>
      </View>
    </GlassSurface>
  );
}

export function PageHeaderIconButton({
  icon,
  label,
  onPress,
  disabled,
  loading,
}: {
  icon: React.ComponentProps<typeof Icon>["name"];
  label: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <HeaderGlassButton
      icon={icon}
      label={label}
      onPress={onPress}
      disabled={disabled}
      loading={loading}
    />
  );
}
