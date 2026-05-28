import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";
import { useTheme } from "@/lib/theme-context";

type Props = {
  status: AutoSaveStatus;
  error?: string | null;
};

export function CardSaveStatus({ status, error }: Props) {
  const { colors } = useTheme();

  if (error) {
    return (
      <View style={styles.row}>
        <Icon name="warning" size={14} color={colors.gradeAgain} />
        <Text style={[styles.text, { color: colors.gradeAgain }]}>Save failed</Text>
      </View>
    );
  }

  if (status === "saving" || status === "pending") {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={colors.fgQuaternary} />
        <Text style={[styles.text, { color: colors.fgQuaternary }]}>Saving…</Text>
      </View>
    );
  }

  if (status === "saved") {
    return (
      <View style={styles.row}>
        <Icon name="check" size={14} color={colors.brand700} />
        <Text style={[styles.text, { color: colors.brand700 }]}>Saved</Text>
      </View>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  text: {
    fontSize: 12,
    fontWeight: "500",
  },
});
