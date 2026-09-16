import { useAccessibilityAnnouncement } from "@/hooks/use-accessibility-announcement";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
  Pressable,
} from "react-native";
import { Icon } from "@/components/ui/icon";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";
import { useTheme } from "@/lib/theme-context";

type Props = {
  status: AutoSaveStatus;
  error?: string | null;
  onRetry?: () => void;
};

export function CardSaveStatus({ status, error, onRetry }: Props) {
  const { colors } = useTheme();
  useAccessibilityAnnouncement(error || (status === "saved" ? "Card saved" : null));

  if (error) {
    return (
      <View style={styles.row}>
        <Icon name="warning" size={14} color={colors.fgError} />
        <Text
          style={[styles.text, { color: colors.fgError }]}
          accessibilityRole="alert"
        >
          {error}
        </Text>
        {onRetry && (
          <Pressable
            accessibilityRole="button"
            onPress={onRetry}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text style={{ color: colors.brand700 }}>Retry save</Text>
          </Pressable>
        )}
      </View>
    );
  }

  if (status === "saving" || status === "pending") {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.fgTertiary} />
        <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.fgTertiary }]}>
          Saving…
        </Text>
      </View>
    );
  }

  if (status === "saved") {
    return (
      <View style={styles.row}>
        <Icon name="check" size={14} color={colors.brand700} />
        <Text accessibilityLiveRegion="polite" style={[styles.text, { color: colors.brand700 }]}>Saved</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    flexShrink: 1,
    alignItems: "center",
    gap: 6,
  },
  text: {
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "500",
  },
});
