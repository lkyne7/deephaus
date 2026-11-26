import { type CardType } from "@deephaus/shared";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { CardFieldEditor } from "@/components/card-editor/card-field-editor";
import { clozeAnswers } from "@/components/cloze-text";
import { Icon } from "@/components/ui/icon";
import type { ThemeColors } from "@/lib/theme";
import { useTheme } from "@/lib/theme-context";

export type CardEditorDraft = {
  type: CardType;
  front: string;
  back: string;
  clozeText: string;
  extra: string;
  tagsInput: string;
};

type Props = {
  cardId: string;
  draft: CardEditorDraft;
  onChange: (patch: Partial<CardEditorDraft>) => void;
  disabled?: boolean;
};

/**
 * The card itself, editable in place: question, short rule, answer and note
 * where study shows them. Shared by the card page and the study editor so a
 * card looks the same wherever it is edited.
 */
export function CardEditorFields({ cardId, draft, onChange, disabled }: Props) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const cloze = draft.type === "cloze";
  const hasNote = draft.extra.trim().length > 0;
  // A front and back card without a note doesn't pay for a third web view.
  const [noteOpen, setNoteOpen] = useState(hasNote);
  useEffect(() => {
    setNoteOpen(hasNote);
    // Only a different card closes the note; emptying it while typing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const note = (
    <CardFieldEditor
      label="Note"
      role="note"
      cardId={cardId}
      value={draft.extra}
      onChange={(extra) => onChange({ extra })}
      placeholder="Shown with the answer"
      disabled={disabled}
    />
  );

  if (cloze) {
    const blanks = clozeAnswers(draft.clozeText).length;
    return (
      <View>
        <CardFieldEditor
          label="Text"
          cardId={cardId}
          allowCloze
          value={draft.clozeText}
          onChange={(clozeText) => onChange({ clozeText })}
          placeholder="A sentence to blank words from"
          disabled={disabled}
        />
        <View style={styles.rule} />
        {note}
        <Text style={styles.blanks}>
          {blanks === 0
            ? "Select words and tap Make blank."
            : blanks === 1
              ? "1 blank, so 1 study card."
              : `${blanks} blanks, so ${blanks} study cards.`}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <CardFieldEditor
        label="Front"
        cardId={cardId}
        value={draft.front}
        onChange={(front) => onChange({ front })}
        placeholder="Question"
        disabled={disabled}
      />
      <View style={styles.rule} />
      <CardFieldEditor
        label="Back"
        cardId={cardId}
        value={draft.back}
        onChange={(back) => onChange({ back })}
        placeholder="Answer"
        disabled={disabled}
      />
      {noteOpen || hasNote ? (
        note
      ) : (
        <Pressable
          accessibilityRole="button"
          disabled={disabled}
          onPress={() => setNoteOpen(true)}
          style={({ pressed }) => [styles.addNote, pressed && styles.pressed]}
        >
          <Icon name="add" size={15} color={colors.fgTertiary} />
          <Text style={styles.addNoteText}>Add a note</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    rule: {
      alignSelf: "center",
      width: 48,
      height: 1,
      marginVertical: 14,
      backgroundColor: colors.lineStrong,
    },
    blanks: {
      marginTop: 10,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center",
      color: colors.fgTertiary,
    },
    addNote: {
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      minHeight: 44,
      paddingHorizontal: 12,
    },
    addNoteText: { fontSize: 15, lineHeight: 20, color: colors.fgTertiary },
    pressed: { opacity: 0.6 },
  });
}
