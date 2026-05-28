import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

type Props = {
  value: number;
  height?: number;
  color?: string;
  trackColor?: string;
  style?: StyleProp<ViewStyle>;
};

export function ProgressBar({
  value,
  height = 6,
  color,
  trackColor,
  style,
}: Props) {
  const { colors } = useTheme();
  const fillColor = color ?? colors.brand500;
  const bgColor = trackColor ?? colors.gray200;

  return (
    <View style={[styles.track, { height, backgroundColor: bgColor, borderRadius: height / 2 }, style]}>
      <View
        style={{
          width: `${Math.max(0, Math.min(1, value)) * 100}%`,
          height,
          backgroundColor: fillColor,
          borderRadius: height / 2,
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: "100%",
    overflow: "hidden",
  },
});
