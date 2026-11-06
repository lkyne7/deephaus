import { useMemo } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

type Props = ViewProps & {
  raised?: boolean;
  padding?: number;
};

export function Card({ style, raised, padding, children, ...props }: Props) {
  const { colors, shadows } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.bgSurface,
          borderColor: colors.line,
          borderWidth: 1,
          borderRadius: radius.xl3,
          overflow: "hidden",
        },
        raised: { ...shadows.sm, overflow: "visible" },
      }),
    [colors, shadows],
  );

  return (
    <View
      {...props}
      style={[
        styles.card,
        raised && styles.raised,
        padding != null && { padding },
        style,
      ]}
    >
      {children}
    </View>
  );
}
