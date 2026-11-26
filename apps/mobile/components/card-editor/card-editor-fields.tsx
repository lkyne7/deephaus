import { type CardType } from "@deephaus/shared";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { CardFieldEditor } from "@/components/card-editor/card-field-editor";
import {
  FormField,
  FormGroup,
  FormRow,
  FormSection,
  FormSwitchRow,
} from "@/components/card-editor/card-form";
import { useEditorToolbar } from "@/components/card-editor/editor-toolbar-context";
import { clozeAnswers } from "@/components/cloze-text";
import { TextPromptModal } from "@/components/ui/text-prompt-modal";
import { clozeHint, parseTagsInput, setClozeHint } from "@/lib/card-text-editing";

export type CardEditorDraft = {
  type: CardType;
  front: string;
  back: string;
  clozeText: string;
  extra: string;
  tagsInput: string;
};

/** The card page's Details group. Study's editor leaves it out. */
export type CardEditorDetails = {
  deck: string;
  suspended: boolean;
  onToggleSuspend: () => void;
  onEditTags: () => void;
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
 * The card as a grouped form (the E2 editor): each side in its own field under
 * a small heading, the note below, a fill-in card's blanks listed with their
 * hints, then the card's details. Shared by the card page and study's editor.
 */
export function CardEditorFields({ cardId, draft, onChange, disabled, details }: Props) {
  const { active } = useEditorToolbar();
  const cloze = draft.type === "cloze";
  const hasNote = draft.extra.trim().length > 0;
  // A card without a note doesn't pay for another web view until one is wanted.
  const [noteOpen, setNoteOpen] = useState(hasNote);
  const [hintFor, setHintFor] = useState<number | null>(null);
  useEffect(() => {
    setNoteOpen(hasNote);
    // Only a different card closes the note; emptying it while typing must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId]);

  const focusedLabel = active?.id.startsWith(`${cardId}:`) ? active.id.slice(cardId.length + 1) : null;

  function field(label: string, value: string, key: keyof CardEditorDraft, placeholder: string, extra?: { allowCloze?: boolean; role?: "note" }) {
    return (
      <FormGroup focused={focusedLabel === label.toLowerCase()}>
        <FormField>
          <CardFieldEditor
            label={label}
            role={extra?.role}
            allowCloze={extra?.allowCloze}
            cardId={cardId}
            value={value}
            onChange={(next) => onChange({ [key]: next } as Partial<CardEditorDraft>)}
            placeholder={placeholder}
            disabled={disabled}
          />
        </FormField>
      </FormGroup>
    );
  }

  const note = (
    <FormSection title="Note">
      {noteOpen || hasNote ? (
        field("Note", draft.extra, "extra", "Shown with the answer", { role: "note" })
      ) : (
        <FormGroup>
          <FormRow
            first
            ghost
            label="Add a note"
            onPress={() => setNoteOpen(true)}
            disabled={disabled}
            accessibilityHint="Adds a note shown with the answer."
          />
        </FormGroup>
      )}
    </FormSection>
  );

  const blanks = cloze ? clozeAnswers(draft.clozeText) : [];

  return (
    <View>
      {cloze ? (
        <>
          <FormSection
            title={blanks.length === 0 ? "Text" : `Text · ${blanks.length} blank${blanks.length === 1 ? "" : "s"}`}
            footer={blanks.length === 0 ? "Select words and tap Make blank. Each blank is its own study card." : undefined}
          >
            {field("Text", draft.clozeText, "clozeText", "A sentence to blank words from", { allowCloze: true })}
          </FormSection>
          {note}
          {blanks.length > 0 ? (
            <FormSection title="Blanks">
              <FormGroup>
                {blanks.map(({ ord, answer }, index) => {
                  const hint = clozeHint(draft.clozeText, ord);
                  return (
                    <FormRow
                      key={ord}
                      first={index === 0}
                      number={ord}
                      label={answer}
                      value={hint ? `Hint: ${hint}` : "Add a hint"}
                      onPress={() => setHintFor(ord)}
                      disabled={disabled}
                      accessibilityLabel={`Blank ${ord}, ${answer}. ${hint ? `Hint: ${hint}` : "No hint"}`}
                      accessibilityHint="Edits this blank's hint."
                    />
                  );
                })}
              </FormGroup>
            </FormSection>
          ) : null}
        </>
      ) : (
        <>
          <FormSection title="Front">{field("Front", draft.front, "front", "Question")}</FormSection>
          <FormSection title="Back">{field("Back", draft.back, "back", "Answer")}</FormSection>
          {note}
        </>
      )}

      {details ? <CardDetailsGroup details={details} tagsInput={draft.tagsInput} disabled={disabled} /> : null}

      <TextPromptModal
        visible={hintFor != null}
        title={hintFor != null ? `Hint for blank ${hintFor}` : "Hint"}
        description="Shown in the blank while studying."
        placeholder="Optional hint"
        initialValue={hintFor != null ? (clozeHint(draft.clozeText, hintFor) ?? "") : ""}
        clearLabel={hintFor != null && clozeHint(draft.clozeText, hintFor) ? "Remove hint" : undefined}
        accessibilityLabel="Hint for this blank"
        onSubmit={(hint) => {
          if (hintFor == null) return;
          onChange({ clozeText: setClozeHint(draft.clozeText, hintFor, hint.trim() || null) });
        }}
        onClear={() => {
          if (hintFor == null) return;
          onChange({ clozeText: setClozeHint(draft.clozeText, hintFor, null) });
        }}
        onClose={() => setHintFor(null)}
      />
    </View>
  );
}

/** Deck, tags, Active and Delete: everything about a card that isn't written on it. */
export function CardDetailsGroup({
  details,
  tagsInput,
  disabled,
}: {
  details: CardEditorDetails;
  tagsInput: string;
  disabled?: boolean;
}) {
  const tags = parseTagsInput(tagsInput);
  return (
    <>
      <FormSection title="Details">
        <FormGroup>
          <FormRow first label="Deck" value={details.deck} />
          <FormRow
            label="Tags"
            value={tags.length ? tags.join(", ") : "None"}
            onPress={details.onEditTags}
            disabled={disabled}
            accessibilityHint="Edits this card's tags."
          />
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
