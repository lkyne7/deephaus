import { useMemo } from "react";
import { StyleSheet, View, type ViewProps } from "react-native";
import { useTheme } from "@/lib/theme-context";
import { radius } from "@/lib/theme";

type Props = ViewProps & {
  raised?: boolean;
  padding?: number;
};

export function Card({ style, raised, padding, children, ...props }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(
    () =>
      StyleSheet.create({
        card: {
          backgroundColor: colors.bgSurface,
          borderColor: colors.borderSecondary,
          borderWidth: 1,
          borderRadius: radius.lg,
          overflow: "hidden",
        },
        raised: {
          shadowColor: colors.gray900,
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.08,
          shadowRadius: 12,
          elevation: 6,
        },
      }),
    [colors],
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
