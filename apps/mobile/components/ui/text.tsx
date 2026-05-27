import { StyleSheet, Text, type TextProps } from "react-native";
import { theme } from "@/lib/theme";

export function ScreenTitle({ children, ...props }: TextProps) {
  return (
    <Text {...props} style={[styles.title, props.style]}>
      {children}
    </Text>
  );
}

export function MutedText({ children, ...props }: TextProps) {
  return (
    <Text {...props} style={[styles.muted, props.style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: theme.colors.text,
  },
  muted: {
    color: theme.colors.muted,
    fontSize: 14,
  },
});
