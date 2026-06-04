import { type CardType } from "@deephaus/shared";
import { StyleSheet, View } from "react-native";
import { CardFieldEditor } from "@/components/card-editor/card-field-editor";
import { CardTagsEditor } from "@/components/card-editor/card-tags-editor";

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
  const frontValue = draft.type === "cloze" ? draft.clozeText : draft.front;
  const backValue = draft.type === "cloze" ? draft.extra : draft.back;

  return (
    <View style={styles.fields}>
      <CardFieldEditor
        label="Front"
        cardId={cardId}
        allowCloze={draft.type === "cloze"}
        value={frontValue}
        onChange={(value) =>
          onChange(
            draft.type === "cloze" ? { clozeText: value } : { front: value },
          )
        }
        placeholder={
          draft.type === "cloze"
            ? "Cloze text — select text and tap C"
            : "Question"
        }
        disabled={disabled}
      />
      <CardFieldEditor
        label="Back"
        cardId={cardId}
        value={backValue}
        onChange={(value) =>
          onChange(
            draft.type === "cloze" ? { extra: value } : { back: value, extra: "" },
          )
        }
        placeholder={draft.type === "cloze" ? "Answer shown on reveal" : "Answer"}
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
    gap: 12,
  },
});
