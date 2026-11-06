import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Icon } from "@/components/ui/icon";
import { uniqueTags, parseTagsInput } from "@/lib/card-text-editing";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
};

function CardTagsEditorField({
  value,
  onChange,
  disabled = false,
  label = "Tags",
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tags = uniqueTags(parseTagsInput(value));
  const [draft, setDraft] = useState("");

  function commitTags(nextTags: string[]) {
    onChange(uniqueTags(nextTags).join(", "));
    setDraft("");
  }

  function removeTag(tag: string) {
    commitTags(tags.filter((item) => item !== tag));
  }

  function addFromDraft(raw: string) {
    const incoming = raw
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (incoming.length === 0) return;
    commitTags([...tags, ...incoming]);
  }

  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={[styles.tagField, disabled && styles.tagFieldDisabled]}>
        {tags.map((tag) => (
          <View key={tag} style={styles.tagPill}>
            <Text style={styles.tagText}>{tag}</Text>
            {!disabled ? (
              <Pressable
                onPress={() => removeTag(tag)}
                hitSlop={14}
                style={styles.removeTag}
                accessibilityRole="button"
                accessibilityLabel={`Remove tag ${tag}`}
              >
                <Icon name="close" size={12} color={colors.fgTertiary} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <TextInput
          accessibilityLabel={label}
          accessibilityHint="Enter a tag, then press Done or use a comma to add more."
          style={styles.tagInput}
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={() => addFromDraft(draft)}
          onBlur={() => {
            if (draft.trim()) addFromDraft(draft);
          }}
          placeholder={tags.length === 0 ? "Add tags…" : ""}
          placeholderTextColor={colors.fgPlaceholder}
          selectionColor={colors.accent}
          editable={!disabled}
          returnKeyType="done"
        />
      </View>
    </View>
  );
}

export function CardTagsEditor(props: Props) {
  return <CardTagsEditorField key={props.value} {...props} />;
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    field: {
      gap: 8,
    },
    fieldLabel: {
      fontSize: 13,
      lineHeight: 18,
      fontWeight: "500",
      color: colors.fgPrimary,
    },
    tagField: {
      flexDirection: "row",
      flexWrap: "wrap",
      alignItems: "center",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
    },
    tagFieldDisabled: {
      opacity: 0.6,
    },
    tagPill: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.bgSunken,
    },
    // 16pt box plus the 14pt hitSlop keeps the 44pt target without a tall pill.
    removeTag: {
      width: 16,
      height: 16,
      alignItems: "center",
      justifyContent: "center",
    },
    tagText: {
      fontSize: 12,
      fontWeight: "500",
      color: colors.fgSecondary,
    },
    tagInput: {
      flex: 1,
      minWidth: 80,
      fontSize: 14,
      color: colors.fgPrimary,
      padding: 0,
    },
  });
}
