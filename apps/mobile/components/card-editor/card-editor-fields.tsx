import { type CardType } from "@deephaus/shared";
import { StyleSheet, Text, View } from "react-native";
import { CardFieldEditor } from "@/components/card-editor/card-field-editor";
import { CardTagsEditor } from "@/components/card-editor/card-tags-editor";
import { clozeAnswers } from "@/components/cloze-text";
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
  showTags?: boolean;
};

export function CardEditorFields({
  cardId,
  draft,
  onChange,
  disabled,
  showTags = true,
}: Props) {
  const { colors } = useTheme();
  const cloze = draft.type === "cloze";
  const frontValue = cloze ? draft.clozeText : draft.front;
  const backValue = cloze ? draft.extra : draft.back;
  const blanks = cloze ? clozeAnswers(draft.clozeText).length : 0;
  // Each numbered blank is studied as its own card.
  const blankNote =
    blanks === 0
      ? "Select words and tap C to make a blank."
      : blanks === 1
        ? "Each blank becomes its own study card."
        : `${blanks} blanks, so ${blanks} study cards.`;

  return (
    <View style={styles.fields}>
      <View style={styles.field}>
        <CardFieldEditor
          label={cloze ? "Text" : "Front"}
          cardId={cardId}
          allowCloze={draft.type === "cloze"}
          value={frontValue}
          onChange={(value) =>
            onChange(
              draft.type === "cloze" ? { clozeText: value } : { front: value },
            )
          }
          placeholder={cloze ? "A sentence to blank words from" : "Question"}
          disabled={disabled}
        />
        {cloze ? (
          <Text style={[styles.note, { color: colors.fgTertiary }]}>{blankNote}</Text>
        ) : null}
      </View>
      <CardFieldEditor
        label={cloze ? "Extra" : "Back"}
        cardId={cardId}
        value={backValue}
        onChange={(value) =>
          onChange(
            draft.type === "cloze" ? { extra: value } : { back: value },
          )
        }
        placeholder={cloze ? "Shown with the answer" : "Answer"}
        disabled={disabled}
      />
      {showTags ? (
        <CardTagsEditor
          value={draft.tagsInput}
          onChange={(tagsInput) => onChange({ tagsInput })}
          disabled={disabled}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fields: {
    gap: 16,
  },
  field: { gap: 6 },
  note: { fontSize: 12, lineHeight: 16, paddingHorizontal: 2 },
});
