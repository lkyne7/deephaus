import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme-context";

type Props = {
  initials: string;
  size?: "sm" | "md" | "lg" | "xl";
  variant?: "brand" | "soft";
  style?: StyleProp<ViewStyle>;
};

const SIZES: Record<NonNullable<Props["size"]>, { box: number; font: number }> = {
  sm: { box: 32, font: 12 },
  md: { box: 40, font: 14 },
  lg: { box: 48, font: 16 },
  xl: { box: 60, font: 20 },
};

export function Avatar({ initials, size = "md", variant = "brand", style }: Props) {
  const { colors } = useTheme();
  const { box, font } = SIZES[size];
  const isBrand = variant === "brand";

  return (
    <View
      style={[
        styles.base,
        {
          width: box,
          height: box,
          borderRadius: box / 2,
          backgroundColor: isBrand ? colors.brand500 : colors.brand100,
        },
        style,
      ]}
    >
      <Text
        style={{
          color: isBrand ? colors.white : colors.brand700,
          fontWeight: "600",
          fontSize: font,
        }}
      >
        {initials}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
  },
});
