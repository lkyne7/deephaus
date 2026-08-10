import { useQuery, useStatus } from "@powersync/react";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { offlineEnabled } from "@/lib/powersync";
import { radius } from "@/lib/theme";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/**
 * Connectivity + pending-uploads indicator for offline-first mode. Hidden when
 * everything is synced (the happy path) and when PowerSync isn't configured.
 */
export function SyncStatusPill() {
  if (!offlineEnabled) return null;
  return <SyncStatusPillInner />;
}

function SyncStatusPillInner() {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const status = useStatus();
  const { data: pendingRows } = useQuery<{ count: number }>(
    "SELECT COUNT(*) AS count FROM ps_crud",
  );
  const pending = Number(pendingRows?.[0]?.count ?? 0);

  if (status.connected && pending === 0) return null;

  const label = !status.connected
    ? pending > 0
      ? `Offline · ${pending} pending`
      : "Offline"
    : `Syncing ${pending}…`;

  return (
    <View style={styles.pill}>
      <Icon
        name={status.connected ? "refresh" : "cloudOffline"}
        size={13}
        color={colors.fgTertiary}
      />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    pill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      paddingHorizontal: 10,
      height: 28,
      borderRadius: radius.pill,
      backgroundColor: colors.gray100,
    },
    label: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgTertiary,
    },
  });
}
