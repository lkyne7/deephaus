import { cardTypeLabel, type CardType } from "@deephaus/shared";
import { View } from "react-native";
import { CardFieldEditor } from "@/components/card-editor/card-field-editor";
import {
  FormField,
  FormGroup,
  FormRow,
  FormSection,
  FormSwitchRow,
} from "@/components/card-editor/card-form";
import { CardTagsEditor } from "@/components/card-editor/card-tags-editor";
import { useEditorToolbar } from "@/components/card-editor/editor-toolbar-context";
import { clozeAnswers } from "@/components/cloze-text";

export type CardEditorDraft = {
  type: CardType;
  front: string;
  back: string;
  clozeText: string;
  extra: string;
  tagsInput: string;
};

/** The card page's tags and Details group. Study's editor leaves them out. */
export type CardEditorDetails = {
  type: CardType;
  deck: string;
  suspended: boolean;
  onToggleSuspend: () => void;
  onDelete: () => void;
};

type Props = {
  cardId: string;
  draft: CardEditorDraft;
  onChange: (patch: Partial<CardEditorDraft>) => void;
  disabled?: boolean;
  details?: CardEditorDetails;
};

/**
 * The card as a grouped form: Front and Back, or a fill-in card's Text and
 * Extra, each in its own field under a small heading; then, on the card page,
 * its tags and details. Shared by the card page and study's editor.
 */
export function CardEditorFields({ cardId, draft, onChange, disabled, details }: Props) {
  const { active } = useEditorToolbar();
  const focusedLabel = active?.id.startsWith(`${cardId}:`) ? active.id.slice(cardId.length + 1) : null;

  function field(
    label: string,
    value: string,
    key: "front" | "back" | "clozeText" | "extra",
    placeholder: string,
    options?: { allowCloze?: boolean; role?: "note" },
  ) {
    return (
      <FormGroup focused={focusedLabel === label.toLowerCase()}>
        <FormField>
          <CardFieldEditor
            label={label}
            role={options?.role}
            allowCloze={options?.allowCloze}
            cardId={cardId}
            value={value}
            onChange={(next) => onChange({ [key]: next })}
            placeholder={placeholder}
            disabled={disabled}
          />
        </FormField>
      </FormGroup>
    );
  }

  const blanks = draft.type === "cloze" ? clozeAnswers(draft.clozeText).length : 0;

  return (
    <View>
      {draft.type === "cloze" ? (
        <>
          <FormSection
            title="Text"
            footer={
              blanks === 0
                ? "Select words and tap Make blank. Each blank is its own study card."
                : blanks === 1
                  ? "1 blank, so 1 study card."
                  : `${blanks} blanks, so ${blanks} study cards.`
            }
          >
            {field("Text", draft.clozeText, "clozeText", "A sentence to blank words from", { allowCloze: true })}
          </FormSection>
          <FormSection title="Extra">
            {field("Extra", draft.extra, "extra", "Shown with the answer", { role: "note" })}
          </FormSection>
        </>
      ) : (
        <>
          <FormSection title="Front">{field("Front", draft.front, "front", "Question")}</FormSection>
          <FormSection title="Back">{field("Back", draft.back, "back", "Answer")}</FormSection>
        </>
      )}

      {details ? (
        <>
          <FormSection title="Tags">
            <CardTagsEditor
              grouped
              value={draft.tagsInput}
              onChange={(tagsInput) => onChange({ tagsInput })}
              disabled={disabled}
            />
          </FormSection>
          <CardDetailsGroup details={details} disabled={disabled} />
        </>
      ) : null}
    </View>
  );
}

/** Type, deck, Active and Delete: the rest of what isn't written on the card. */
export function CardDetailsGroup({
  details,
  disabled,
}: {
  details: CardEditorDetails;
  disabled?: boolean;
}) {
  return (
    <>
      <FormSection title="Details">
        <FormGroup>
          <FormRow first label="Type" value={cardTypeLabel(details.type, "short")} />
          <FormRow label="Deck" value={details.deck} />
          <FormSwitchRow
            label="Active"
            value={!details.suspended}
            onChange={details.onToggleSuspend}
            disabled={disabled}
          />
        </FormGroup>
      </FormSection>
      <FormSection>
        <FormGroup>
          <FormRow first destructive label="Delete card" onPress={details.onDelete} disabled={disabled} />
        </FormGroup>
      </FormSection>
    </>
  );
}
