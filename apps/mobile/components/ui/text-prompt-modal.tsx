import { useEffect, useMemo, useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@/components/ui/button";
import { GlassSurface } from "@/components/ui/glass-surface";
import { Field } from "@/components/ui/input";
import { layout, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  visible: boolean;
  title: string;
  description?: string;
  placeholder?: string;
  initialValue?: string;
  submitLabel?: string;
  /** Shown as a destructive secondary action when provided. */
  clearLabel?: string;
  accessibilityLabel?: string;
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  onSubmit: (value: string) => void;
  onClear?: () => void;
  onClose: () => void;
};

/** Bottom-sheet text prompt; a cross-platform stand-in for Alert.prompt. */
export function TextPromptModal({
  visible,
  title,
  description,
  placeholder,
  initialValue = "",
  submitLabel = "Save",
  clearLabel,
  accessibilityLabel,
  autoCapitalize = "sentences",
  onSubmit,
  onClear,
  onClose,
}: Props) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(initialValue);

  useEffect(() => {
    if (visible) setDraft(initialValue);
  }, [visible, initialValue]);

  function submit() {
    onSubmit(draft);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.scrim}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Pressable style={styles.scrimPress} onPress={onClose} accessibilityLabel="Dismiss" />
        <GlassSurface
          fallbackColor={colors.bgSurface}
          glassEffectStyle="regular"
          style={[styles.sheet, { marginBottom: Math.max(insets.bottom, layout.floatingGlassInset) }]}
        >
          <Text style={styles.title}>{title}</Text>
          {description ? <Text style={styles.description}>{description}</Text> : null}
          <Field
            accessibilityLabel={accessibilityLabel ?? title}
            value={draft}
            onChangeText={setDraft}
            placeholder={placeholder}
            autoFocus
            autoCapitalize={autoCapitalize}
            autoCorrect={autoCapitalize !== "none"}
            returnKeyType="done"
            onSubmitEditing={submit}
          />
          <View style={styles.actions}>
            {clearLabel && onClear ? (
              <Button
                variant="danger"
                size="md"
                label={clearLabel}
                onPress={() => {
                  onClear();
                  onClose();
                }}
              />
            ) : null}
            <View style={{ flex: 1 }} />
            <Button variant="secondary" size="md" label="Cancel" onPress={onClose} />
            <Button variant="brand" size="md" label={submitLabel} onPress={submit} />
          </View>
        </GlassSurface>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scrim: {
      flex: 1,
      backgroundColor: colors.bgOverlay,
      justifyContent: "flex-end",
    },
    scrimPress: {
      position: "absolute",
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    },
    sheet: {
      marginHorizontal: layout.floatingGlassInset,
      borderRadius: layout.floatingGlassRadius,
      padding: 20,
      gap: 12,
      overflow: "hidden",
    },
    title: {
      fontSize: 16,
      fontWeight: "600",
      color: colors.fgPrimary,
    },
    description: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
      marginTop: -6,
    },
    actions: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      marginTop: 4,
    },
  });
}
