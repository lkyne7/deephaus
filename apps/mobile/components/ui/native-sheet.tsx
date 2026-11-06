import { useMemo } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Pressable,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { NativeSheetProps } from "@/components/ui/native-sheet-types";
import { SheetHeader } from "@/components/ui/sheet-header";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

/** Bottom sheet on Android. iOS uses the system sheet in native-sheet.ios.tsx. */
export function NativeSheet({
  visible,
  onClose,
  title,
  dismissDisabled,
  leading,
  trailing,
  hideHeader,
  children,
}: NativeSheetProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const dismiss = dismissDisabled ? undefined : onClose;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <KeyboardAvoidingView style={styles.root}>
        <Pressable style={StyleSheet.absoluteFill} onPress={dismiss} accessibilityLabel="Dismiss" />
        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          {hideHeader ? null : (
            <SheetHeader
              title={title}
              onClose={onClose}
              leading={leading}
              trailing={trailing}
              closeDisabled={dismissDisabled}
            />
          )}
          {children}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bgOverlay,
      justifyContent: "flex-end",
    },
    sheet: {
      maxHeight: "90%",
      backgroundColor: colors.bgCanvas,
      borderTopLeftRadius: radius.xl4,
      borderTopRightRadius: radius.xl4,
      overflow: "hidden",
    },
  });
}
