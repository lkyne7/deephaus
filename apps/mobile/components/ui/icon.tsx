import { Ionicons } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import type { ColorValue } from "react-native";
import { ICON_NAMES, type IconName } from "@/components/ui/icon-names";
import { useTheme } from "@/lib/theme-context";


type Props = Omit<ComponentProps<typeof Ionicons>, "name"> & {
  name: IconName;
  size?: number;
  color?: ColorValue;
};

export function Icon({ name, size = 18, color, ...rest }: Props) {
  const { colors } = useTheme();
  return (
    <Ionicons
      {...rest}
      name={ICON_NAMES[name] as ComponentProps<typeof Ionicons>["name"]}
      size={size}
      color={color ?? colors.fgSecondary}
    />
  );
}

export type { IconName };
