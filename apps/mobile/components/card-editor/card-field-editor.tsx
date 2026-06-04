import { cardMediaSnippet } from "@deephaus/shared";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from "react-native";
import { Field } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { api } from "@/lib/api";
import {
  CLOZE_IDS,
  addClozeSelection,
  findClozeForSelection,
  insertLatexBlock,
  insertLatexInline,
  removeClozeMatch,
  updateClozeMatch,
  wrapSelectedLines,
  wrapSelection,
  type TextSelection,
} from "@/lib/card-text-editing";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  cardId: string;
  placeholder?: string;
  disabled?: boolean;
  allowCloze?: boolean;
};

type ToolbarButton = {
  label: string;
  title: string;
  onPress: () => void;
};

export function CardFieldEditor({
  label,
  value,
  onChange,
  cardId,
  placeholder,
  disabled,
  allowCloze = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const inputRef = useRef<TextInput>(null);
  const [selection, setSelection] = useState<TextSelection>({ start: 0, end: 0 });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [hintDraft, setHintDraft] = useState("");

  const activeCloze = allowCloze ? findClozeForSelection(value, selection) : null;

  function applyEdit(
    edit: (current: string, currentSelection: TextSelection) => {
      text: string;
      selection: TextSelection;
    },
  ) {
    const result = edit(value, selection);
    onChange(result.text);
    setSelection(result.selection);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleSelectionChange(event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) {
    const next = event.nativeEvent.selection;
    setSelection(next);
    if (allowCloze) {
      const match = findClozeForSelection(value, next);
      setHintDraft(match?.hint ?? "");
    }
  }

  async function uploadImage() {
    setUploadError(null);
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.9,
    });
    if (result.canceled || !result.assets[0]) return;

    setUploading(true);
    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const blob = await response.blob();
      const filename = asset.fileName ?? "image.jpg";
      const { url } = await api.uploadCardMedia(cardId, blob, filename);
      onChange(`${value}${cardMediaSnippet(url)}`);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const toolbarButtons: ToolbarButton[] = [
    {
      label: "B",
      title: "Bold",
      onPress: () => applyEdit((text, sel) => wrapSelection(text, sel, "**", "**")),
    },
    {
      label: "I",
      title: "Italic",
      onPress: () => applyEdit((text, sel) => wrapSelection(text, sel, "*", "*")),
    },
    {
      label: "U",
      title: "Underline",
      onPress: () => applyEdit((text, sel) => wrapSelection(text, sel, "<u>", "</u>")),
    },
    {
      label: "</>",
      title: "Inline code",
      onPress: () => applyEdit((text, sel) => wrapSelection(text, sel, "`", "`")),
    },
    {
      label: "•",
      title: "Bullet list",
      onPress: () => applyEdit((text, sel) => wrapSelectedLines(text, sel, "- ")),
    },
    {
      label: "1.",
      title: "Numbered list",
      onPress: () => applyEdit((text, sel) => wrapSelectedLines(text, sel, "1. ")),
    },
    ...(allowCloze
      ? [
          {
            label: "C",
            title: "New cloze",
            onPress: () => applyEdit((text, sel) => addClozeSelection(text, sel)),
          },
        ]
      : []),
    {
      label: "∑",
      title: "Inline LaTeX",
      onPress: () => applyEdit((text, sel) => insertLatexInline(text, sel)),
    },
    {
      label: "∫",
      title: "Block LaTeX",
      onPress: () => applyEdit((text, sel) => insertLatexBlock(text, sel)),
    },
  ];

  return (
    <View style={styles.field}>
      <View style={styles.labelRow}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Pressable
          onPress={() => void uploadImage()}
          disabled={disabled || uploading}
          style={[styles.uploadBtn, (disabled || uploading) && styles.uploadBtnDisabled]}
        >
          {uploading ? (
            <ActivityIndicator size="small" color={colors.fgSecondary} />
          ) : (
            <Icon name="upload" size={14} color={colors.fgSecondary} />
          )}
          <Text style={styles.uploadText}>{uploading ? "Uploading…" : "Add image"}</Text>
        </Pressable>
      </View>

      <View style={styles.toolbar}>
        {toolbarButtons.map((button) => (
          <Pressable
            key={button.title}
            onPress={button.onPress}
            disabled={disabled}
            style={[styles.toolbarBtn, disabled && styles.toolbarBtnDisabled]}
            accessibilityRole="button"
            accessibilityLabel={button.title}
          >
            <Text style={styles.toolbarBtnText}>{button.label}</Text>
          </Pressable>
        ))}
      </View>

      {activeCloze ? (
        <View style={styles.clozePanel}>
          <Text style={styles.clozeTitle}>Cloze deletion</Text>
          <View style={styles.clozeIds}>
            {CLOZE_IDS.map((id) => (
              <Pressable
                key={id}
                onPress={() => {
                  onChange(updateClozeMatch(value, activeCloze, { id }));
                }}
                style={[
                  styles.clozeIdBtn,
                  activeCloze.id === id && styles.clozeIdBtnActive,
                ]}
              >
                <Text
                  style={[
                    styles.clozeIdText,
                    activeCloze.id === id && styles.clozeIdTextActive,
                  ]}
                >
                  {id.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
          <View>
            <Text style={styles.hintLabel}>Hint</Text>
            <Field
              value={hintDraft}
              onChangeText={setHintDraft}
              placeholder="Optional hint shown when studying"
              onBlur={() => {
                onChange(
                  updateClozeMatch(value, activeCloze, {
                    hint: hintDraft.trim() || null,
                  }),
                );
              }}
              onSubmitEditing={() => {
                onChange(
                  updateClozeMatch(value, activeCloze, {
                    hint: hintDraft.trim() || null,
                  }),
                );
              }}
            />
          </View>
          <Pressable
            onPress={() => onChange(removeClozeMatch(value, activeCloze))}
            style={styles.removeClozeBtn}
          >
            <Icon name="warning" size={14} color={colors.gradeAgain} />
            <Text style={styles.removeClozeText}>Remove deletion</Text>
          </Pressable>
        </View>
      ) : null}

      <Field
        ref={inputRef}
        multiline
        value={value}
        onChangeText={onChange}
        onSelectionChange={handleSelectionChange}
        selection={selection}
        placeholder={placeholder}
        editable={!disabled && !uploading}
        containerStyle={styles.textarea}
        inputStyle={styles.textareaInput}
      />

      {uploadError ? <Text style={styles.errorText}>{uploadError}</Text> : null}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      gap: 8,
    },
    labelRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
    },
    fieldLabel: {
      fontSize: 11,
      fontWeight: "600",
      color: colors.fgQuaternary,
      textTransform: "uppercase",
      letterSpacing: 0.6,
    },
    uploadBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      backgroundColor: colors.bgSurface,
    },
    uploadBtnDisabled: {
      opacity: 0.5,
    },
    uploadText: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    toolbar: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    toolbarBtn: {
      minWidth: 32,
      height: 32,
      paddingHorizontal: 8,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      backgroundColor: colors.bgSurface,
      alignItems: "center",
      justifyContent: "center",
    },
    toolbarBtnDisabled: {
      opacity: 0.5,
    },
    toolbarBtnText: {
      fontSize: 13,
      fontWeight: "700",
      color: colors.fgSecondary,
    },
    clozePanel: {
      gap: 10,
      padding: 12,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      backgroundColor: colors.bgSurface,
    },
    clozeTitle: {
      fontSize: 12,
      fontWeight: "600",
      color: colors.fgSecondary,
      textTransform: "uppercase",
      letterSpacing: 0.5,
    },
    clozeIds: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
    },
    clozeIdBtn: {
      minWidth: 34,
      height: 30,
      paddingHorizontal: 8,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.borderSecondary,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: colors.bgCanvas,
    },
    clozeIdBtnActive: {
      borderColor: colors.brand500,
      backgroundColor: colors.brand50,
    },
    clozeIdText: {
      fontSize: 11,
      fontWeight: "700",
      color: colors.fgSecondary,
    },
    clozeIdTextActive: {
      color: colors.brand700,
    },
    hintLabel: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgTertiary,
      marginBottom: 6,
    },
    removeClozeBtn: {
      flexDirection: "row",
      alignItems: "center",
      gap: 6,
    },
    removeClozeText: {
      fontSize: 13,
      fontWeight: "500",
      color: colors.gradeAgain,
    },
    textarea: {
      minHeight: 72,
      alignItems: "flex-start",
      paddingVertical: 8,
    },
    textareaInput: {
      minHeight: 40,
      textAlignVertical: "top",
    },
    errorText: {
      fontSize: 12,
      color: colors.gradeAgain,
    },
  });
}
