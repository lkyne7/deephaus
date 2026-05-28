import { useMemo } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/ui/icon";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

const FONT_SCALE_LABELS = ["Small", "Default", "Large", "Extra large"];

type Props = {
  visible: boolean;
  fontIndex: number;
  fontScaleCount: number;
  onClose: () => void;
  onDecreaseFont: () => void;
  onIncreaseFont: () => void;
  onSuspend: () => void;
  suspending?: boolean;
};

export function StudyOptionsSheet({
  visible,
  fontIndex,
  fontScaleCount,
  onClose,
  onDecreaseFont,
  onIncreaseFont,
  onSuspend,
  suspending,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 16) }]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>Study options</Text>

          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Text size</Text>
            <View style={styles.fontRow}>
              <Pressable
                onPress={onDecreaseFont}
                disabled={fontIndex <= 0}
                style={[styles.fontBtn, fontIndex <= 0 && styles.fontBtnDisabled]}
              >
                <Text style={styles.fontBtnText}>A−</Text>
              </Pressable>
              <Text style={styles.fontLabel}>{FONT_SCALE_LABELS[fontIndex] ?? "Default"}</Text>
              <Pressable
                onPress={onIncreaseFont}
                disabled={fontIndex >= fontScaleCount - 1}
                style={[
                  styles.fontBtn,
                  fontIndex >= fontScaleCount - 1 && styles.fontBtnDisabled,
                ]}
              >
                <Text style={styles.fontBtnText}>A+</Text>
              </Pressable>
            </View>
          </View>

          <Pressable
            onPress={onSuspend}
            disabled={suspending}
            style={({ pressed }) => [
              styles.actionRow,
              styles.suspendRow,
              pressed && { opacity: 0.7 },
              suspending && { opacity: 0.5 },
            ]}
          >
            <Icon name="pause" size={20} color={colors.gradeAgain} />
            <Text style={styles.suspendText}>{suspending ? "Suspending…" : "Suspend card"}</Text>
          </Pressable>

          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.4)",
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.bgSurface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingHorizontal: 20,
      paddingTop: 12,
      gap: 8,
    },
    handle: {
      alignSelf: "center",
      width: 36,
      height: 4,
      borderRadius: 999,
      backgroundColor: colors.gray300,
      marginBottom: 8,
    },
    sheetTitle: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
      marginBottom: 8,
    },
    section: {
      gap: 10,
      paddingVertical: 8,
    },
    sectionLabel: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgQuaternary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    fontRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    },
    fontBtn: {
      width: 44,
      height: 44,
      borderRadius: radius.lg,
      backgroundColor: colors.bgCanvas,
      borderColor: colors.borderSecondary,
      borderWidth: 1,
      alignItems: "center",
      justifyContent: "center",
    },
    fontBtnDisabled: {
      opacity: 0.4,
    },
    fontBtnText: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgSecondary,
    },
    fontLabel: {
      flex: 1,
      textAlign: "center",
      fontSize: 15,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    actionRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      paddingVertical: 14,
      paddingHorizontal: 4,
    },
    suspendRow: {
      borderTopColor: colors.borderSecondary,
      borderTopWidth: 1,
      marginTop: 4,
    },
    suspendText: {
      fontSize: 16,
      fontWeight: "500",
      color: colors.gradeAgain,
    },
    cancelBtn: {
      alignItems: "center",
      paddingVertical: 14,
      marginTop: 4,
    },
    cancelText: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgSecondary,
    },
  });
}
