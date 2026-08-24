import { View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme-context";

// Bar heights as fractions of the tile size, from the DeepHaus logo kit.
const BAR_HEIGHTS = [0.25, 0.53, 0.39, 0.17];

type Props = {
  /** Tile size in px; everything inside scales proportionally. */
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * DeepHaus brand mark — solid rounded tile with four equalizer pill bars.
 *
 * Mirrors the web `BrandMark`: the tile uses `fgPrimary` and the bars
 * `bgSurface`, so it renders as the ink tile in light mode and inverts to
 * the white tile in dark mode. Built from plain Views (no SVG needed).
 */
export function BrandMark({ size = 64, style }: Props) {
  const { colors } = useTheme();
  const barWidth = size * 0.09375;

  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="DeepHaus"
      style={[
        {
          width: size,
          height: size,
          borderRadius: size * 0.25,
          backgroundColor: colors.fgPrimary,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: size * 0.0625,
        },
        style,
      ]}
    >
      {BAR_HEIGHTS.map((h, i) => (
        <View
          key={i}
          style={{
            width: barWidth,
            height: size * h,
            borderRadius: barWidth / 2,
            backgroundColor: colors.bgSurface,
          }}
        />
      ))}
    </View>
  );
}
