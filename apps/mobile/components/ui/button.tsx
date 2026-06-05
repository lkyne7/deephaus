import { useMemo } from "react";
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  type PressableProps,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { Icon, type IconName } from "@/components/ui/icon";
import { useTheme } from "@/lib/theme-context";
import { radius, type ThemeColors } from "@/lib/theme";

export type ButtonVariant =
  | "primary"
  | "brand"
  | "secondary"
  | "tertiary"
  | "danger";

export type ButtonSize = "sm" | "md" | "lg" | "xl";

type Props = Omit<PressableProps, "style"> & {
  label?: string;
  children?: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pill?: boolean;
  leadingIcon?: IconName;
  trailingIcon?: IconName;
  iconOnly?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
};

const SIZE_PADDING: Record<
  ButtonSize,
  { paddingVertical: number; paddingHorizontal: number; iconSize: number; fontSize: number; lineHeight: number }
> = {
  sm: { paddingVertical: 8, paddingHorizontal: 12, iconSize: 14, fontSize: 14, lineHeight: 20 },
  md: { paddingVertical: 10, paddingHorizontal: 14, iconSize: 16, fontSize: 14, lineHeight: 20 },
  lg: { paddingVertical: 12, paddingHorizontal: 16, iconSize: 18, fontSize: 16, lineHeight: 24 },
  xl: { paddingVertical: 14, paddingHorizontal: 18, iconSize: 20, fontSize: 16, lineHeight: 24 },
};

function variantStyles(colors: ThemeColors) {
  return {
    bg: {
      primary: colors.actionPrimaryBg,
      brand: colors.actionBrandBg,
      secondary: colors.actionSecondaryBg,
      tertiary: "transparent",
      danger: colors.actionDangerBg,
    } satisfies Record<ButtonVariant, string>,
    fg: {
      primary: colors.actionPrimaryFg,
      brand: colors.actionBrandFg,
      secondary: colors.actionSecondaryFg,
      tertiary: colors.actionTertiaryFg,
      danger: colors.actionDangerFg,
    } satisfies Record<ButtonVariant, string>,
  };
}

export function Button({
  label,
  children,
  variant = "primary",
  size = "md",
  pill = false,
  leadingIcon,
  trailingIcon,
  iconOnly = false,
  loading,
  disabled,
  fullWidth,
  style,
  textStyle,
  ...rest
}: Props) {
  const { colors } = useTheme();
  const variants = useMemo(() => variantStyles(colors), [colors]);
  const dims = SIZE_PADDING[size];
  const bg = variants.bg[variant];
  const fg = variants.fg[variant];
  const borderColor = variant === "secondary" ? colors.actionSecondaryBorder : "transparent";

  return (
    <Pressable
      {...rest}
      disabled={disabled || loading}
      android_ripple={{ color: "rgba(255,255,255,0.10)" }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: bg,
          borderColor,
          borderRadius: pill ? radius.pill : radius.lg,
          paddingVertical: dims.paddingVertical,
          paddingHorizontal: iconOnly ? dims.paddingVertical : dims.paddingHorizontal,
        },
        fullWidth && { alignSelf: "stretch" },
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {leadingIcon && <Icon name={leadingIcon} size={dims.iconSize} color={fg} />}
          {(label || children) && !iconOnly && (
            <Text
              style={[
                styles.label,
                { color: fg, fontSize: dims.fontSize, lineHeight: dims.lineHeight },
                textStyle,
              ]}
            >
              {label ?? children}
            </Text>
          )}
          {trailingIcon && <Icon name={trailingIcon} size={dims.iconSize} color={fg} />}
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderWidth: 1,
  },
  label: {
    fontWeight: "600",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.85,
  },
});
