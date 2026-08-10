import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card } from "@/components/ui/card";
import { FeaturedIcon } from "@/components/ui/featured-icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Notice shown in place of online-only features while offline. */
export function OfflineNotice({ feature }: { feature: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <Card padding={20} style={styles.card}>
      <FeaturedIcon icon="cloudOffline" variant="gray" size="lg" />
      <Text style={styles.title}>You&apos;re offline</Text>
      <Text style={styles.body}>
        {feature} needs an internet connection. Studying and editing your decks
        still works offline.
      </Text>
    </Card>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    card: {
      alignItems: "center",
      gap: 4,
      marginHorizontal: 16,
      marginTop: 16,
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginTop: 12,
    },
    body: {
      fontSize: 13,
      color: colors.fgTertiary,
      textAlign: "center",
    },
  });
}
