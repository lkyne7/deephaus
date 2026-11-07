import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components/ui/button";
import { Icon, type IconName } from "@/components/ui/icon";
import { Field } from "@/components/ui/input";
import { NativeSheet } from "@/components/ui/native-sheet";
import { radius, type ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

type Props = {
  visible: boolean;
  onClose: () => void;
  onFile: () => void;
  onPaste: () => void;
  onImport: () => void;
  /** Called with a deck name when no deck is chosen yet, otherwise with nothing. */
  onWriteCard: (newDeckName?: string) => void;
  /** Whether a hand-written card has a deck to go to. */
  hasDeck: boolean;
};

/** Everything the composer's + can add. It means the same thing everywhere. */
export function AddSourceSheet({
  visible,
  onClose,
  onFile,
  onPaste,
  onImport,
  onWriteCard,
  hasDeck,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [namingDeck, setNamingDeck] = useState(false);
  const [deckName, setDeckName] = useState("");

  useEffect(() => {
    if (visible) {
      setNamingDeck(false);
      setDeckName("");
    }
  }, [visible]);

  const row = (icon: IconName, label: string, onPress: () => void, first = false) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.row, !first && styles.rowLine, pressed && styles.pressed]}
    >
      <Icon name={icon} size={21} color={colors.fgSecondary} />
      <Text style={styles.rowLabel}>{label}</Text>
    </Pressable>
  );

  return (
    <NativeSheet
      visible={visible}
      onClose={onClose}
      title={namingDeck ? "Name your deck" : "Add a source"}
      detents={[{ height: namingDeck ? 240 : 310 }]}
    >
      {namingDeck ? (
        <View style={styles.content}>
          <Field
            value={deckName}
            onChangeText={setDeckName}
            placeholder="e.g. Cardiology"
            accessibilityLabel="Deck name"
            autoFocus
          />
          <Button
            label="Write a card"
            fullWidth
            disabled={!deckName.trim()}
            onPress={() => onWriteCard(deckName.trim())}
          />
        </View>
      ) : (
        <View style={styles.content}>
          <View style={styles.group}>
            {row("document", "Choose a file", onFile, true)}
            {row("text", "Paste a link or notes", onPaste)}
          </View>
          <View style={styles.group}>
            {row(
              "pencil",
              "Write a card by hand",
              () => (hasDeck ? onWriteCard() : setNamingDeck(true)),
              true,
            )}
            {row("download", "Import from Anki or Quizlet", onImport)}
          </View>
        </View>
      )}
    </NativeSheet>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    content: { gap: 14, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 16 },
    group: {
      borderRadius: radius.xl4,
      backgroundColor: colors.bgSurface,
      borderColor: colors.line,
      borderWidth: StyleSheet.hairlineWidth,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: 12,
      minHeight: 52,
      paddingHorizontal: 14,
    },
    rowLine: { borderTopColor: colors.line, borderTopWidth: StyleSheet.hairlineWidth },
    rowLabel: { flex: 1, fontSize: 16, lineHeight: 21, color: colors.fgPrimary },
    pressed: { opacity: 0.6 },
  });
}
