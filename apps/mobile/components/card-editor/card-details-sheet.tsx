import { cardTypeLabel, type CardType } from "@deephaus/shared";
import { useMemo, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { CardTagsEditor } from "@/components/card-editor/card-tags-editor";
import { NativeSheet } from "@/components/ui/native-sheet";
import { haptics } from "@/lib/haptics";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  type: CardType;
  deck: string;
  tagsInput: string;
  onTagsChange: (value: string) => void;
  suspended: boolean;
  onToggleSuspend: () => void;
  onDelete: () => void;
  disabled?: boolean;
};

/** Everything about a card that isn't written on it. */
export function CardDetailsSheet({
  visible,
  onClose,
  type,
  deck,
  tagsInput,
  onTagsChange,
  suspended,
  onToggleSuspend,
  onDelete,
  disabled,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <NativeSheet visible={visible} onClose={onClose} title="Card details">
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <View style={styles.group}>
          <Row label="Type" styles={styles}>
            <Text style={styles.value}>{cardTypeLabel(type, "short")}</Text>
          </Row>
          <Row label="Deck" styles={styles} divided>
            <Text style={styles.value} numberOfLines={1}>
              {deck}
            </Text>
          </Row>
          <Row
            label="Active"
            hint={suspended ? "Suspended: it won't come up in study." : "Comes up in study."}
            styles={styles}
            divided
          >
            <Switch
              value={!suspended}
              disabled={disabled}
              onValueChange={() => {
                haptics.selection();
                onToggleSuspend();
              }}
              trackColor={{ true: colors.accent }}
              accessibilityLabel="Active"
            />
          </Row>
        </View>
        <CardTagsEditor value={tagsInput} onChange={onTagsChange} disabled={disabled} />
        <View style={styles.group}>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onDelete}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.delete}>Delete card</Text>
          </Pressable>
        </View>
      </ScrollView>
    </NativeSheet>
  );
}

function Row({
  label,
  hint,
  divided,
  styles,
  children,
}: {
  label: string;
  hint?: string;
  divided?: boolean;
  styles: ReturnType<typeof createStyles>;
  children: ReactNode;
}) {
  return (
    <View style={[styles.row, divided && styles.divided]}>
      <View style={styles.copy}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    body: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 32, gap: 16 },
    group: {
      borderRadius: radius.xl2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.bgSurface,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 48,
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
    pressed: { backgroundColor: colors.bgHover },
    copy: { flex: 1, gap: 1 },
    label: { fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    hint: { fontSize: 12, lineHeight: 16, color: colors.fgTertiary },
    value: { flexShrink: 1, maxWidth: "65%", fontSize: 16, lineHeight: 21, color: colors.fgTertiary },
    delete: { fontSize: 16, lineHeight: 21, color: colors.danger },
  });
}
