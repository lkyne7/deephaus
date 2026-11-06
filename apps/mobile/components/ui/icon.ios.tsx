import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import type { ComponentProps } from "react";
import type { ColorValue, ImageStyle, StyleProp } from "react-native";
import { ICON_NAMES, SF_SYMBOLS, type IconName } from "@/components/ui/icon-names";
import { useTheme } from "@/lib/theme-context";

type Props = Omit<ComponentProps<typeof Ionicons>, "name"> & {
  name: IconName;
  size?: number;
  color?: ColorValue;
};

/** SF Symbols through expo-image, with Ionicons for brand marks iOS doesn't ship. */
export function Icon({ name, size = 18, color, style, ...rest }: Props) {
  const { colors } = useTheme();
  const tint = color ?? colors.fgSecondary;
  const symbol = SF_SYMBOLS[name];
  if (!symbol) {
    return (
      <Ionicons
        {...rest}
        style={style}
        name={ICON_NAMES[name] as ComponentProps<typeof Ionicons>["name"]}
        size={size}
        color={tint}
      />
    );
  }
  return (
    <Image
      source={`sf:${symbol}`}
      contentFit="contain"
      tintColor={tint as string}
      accessible={false}
      style={[{ width: size, height: size }, style as StyleProp<ImageStyle>]}
    />
  );
}

export type { IconName };
