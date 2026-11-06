import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/input";
import { NativeSheet } from "@/components/ui/native-sheet";
import type { ThemeColors } from "@/lib/theme";
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

/**
 * Asks for one line of text. iOS uses the system alert prompt, except for raw
 * input like LaTeX, where auto-capitalization and autocorrect must stay off and
 * only a sheet can turn them off.
 */
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
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [draft, setDraft] = useState(initialValue);
  const useAlert = Platform.OS === "ios" && autoCapitalize !== "none";

  const latest = useRef({ onSubmit, onClear, onClose });
  latest.current = { onSubmit, onClear, onClose };

  useEffect(() => {
    if (visible) setDraft(initialValue);
  }, [visible, initialValue]);

  useEffect(() => {
    if (!visible || !useAlert) return;
    Alert.prompt(
      title,
      description,
      [
        ...(clearLabel && onClear
          ? [
              {
                text: clearLabel,
                style: "destructive" as const,
                onPress: () => {
                  latest.current.onClear?.();
                  latest.current.onClose();
                },
              },
            ]
          : []),
        { text: "Cancel", style: "cancel", onPress: () => latest.current.onClose() },
        {
          text: submitLabel,
          isPreferred: true,
          onPress: (value?: string) => {
            latest.current.onSubmit(value ?? "");
            latest.current.onClose();
          },
        },
      ],
      "plain-text",
      initialValue,
    );
    // Opens once per presentation; the callbacks are read through `latest`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, useAlert]);

  if (useAlert) return null;

  function submit() {
    onSubmit(draft);
    onClose();
  }

  return (
    <NativeSheet
      visible={visible}
      onClose={onClose}
      title={title}
      detents={[{ height: 240 }]}
      trailing={<Button size="md" variant="brand" label={submitLabel} onPress={submit} />}
      leading={
        clearLabel && onClear ? (
          <Button
            variant="tertiary"
            size="md"
            label={clearLabel}
            textStyle={styles.clearLabel}
            onPress={() => {
              onClear();
              onClose();
            }}
          />
        ) : (
          <Button
            variant="secondary"
            size="md"
            iconOnly
            leadingIcon="close"
            label="Cancel"
            onPress={onClose}
          />
        )
      }
    >
      <View style={styles.body}>
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
      </View>
    </NativeSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: { paddingHorizontal: 16, paddingBottom: 16, gap: 10 },
    clearLabel: { color: colors.danger },
    description: {
      fontSize: 13,
      lineHeight: 18,
      color: colors.fgTertiary,
    },
  });
}
