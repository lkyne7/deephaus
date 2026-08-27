import {
  GlassView,
  isGlassEffectAPIAvailable,
  isLiquidGlassAvailable,
  type GlassStyle,
} from "expo-glass-effect";
import type { ReactNode } from "react";
import {
  Platform,
  View,
  type StyleProp,
  type ViewProps,
  type ViewStyle,
} from "react-native";
import { useTheme } from "@/lib/theme-context";

/**
 * True only when the app was compiled with the Liquid Glass SDK and is
 * running on a device that exposes the iOS 26 glass APIs.
 */
export const liquidGlassAvailable =
  Platform.OS === "ios" &&
  isLiquidGlassAvailable() &&
  isGlassEffectAPIAvailable();

type Props = Omit<ViewProps, "style"> & {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  fallbackColor?: string;
  glassEffectStyle?: GlassStyle;
  interactive?: boolean;
  tintColor?: string;
};

/**
 * Native Liquid Glass on iOS 26, with a deterministic View fallback for
 * older iOS versions and Android.
 */
export function GlassSurface({
  children,
  style,
  fallbackColor = "transparent",
  glassEffectStyle = "regular",
  interactive = false,
  tintColor,
  ...props
}: Props) {
  const { colorScheme } = useTheme();

  if (!liquidGlassAvailable) {
    return (
      <View {...props} style={[{ backgroundColor: fallbackColor }, style]}>
        {children}
      </View>
    );
  }

  return (
    <GlassView
      {...props}
      colorScheme={colorScheme}
      glassEffectStyle={glassEffectStyle}
      isInteractive={interactive}
      tintColor={tintColor}
      style={style}
    >
      {children}
    </GlassView>
  );
}
