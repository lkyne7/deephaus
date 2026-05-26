"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cardTypeLabel } from "@deephaus/shared";
import { CardFieldEditor } from "@/components/card-field-editor";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { CardSaveStatus } from "@/components/card-save-status";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { cardUpdateSnapshot } from "@/lib/cards/update";

export type EditableCard = {
  id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
};

type Props = {
  card: EditableCard | null;
  deckName?: string;
  saving?: boolean;
  busy?: boolean;
  onSave: (draft: EditableCard, tags: string[]) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function basicBackValue(card: EditableCard, draft: Partial<EditableCard>): string {
  return draft.back ?? card.back ?? card.extra ?? "";
}

function mergeEditableCard(card: EditableCard, draft: Partial<EditableCard>): EditableCard {
  return {
    ...card,
    ...draft,
    front: draft.front ?? card.front,
    back: card.type === "basic" ? basicBackValue(card, draft) : draft.back ?? card.back,
    cloze_text: draft.cloze_text ?? card.cloze_text,
    extra: card.type === "basic" ? null : draft.extra ?? card.extra,
  };
}

export function CardEditorPanel({
  card,
  deckName,
  saving = false,
  busy = false,
  onSave,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<Partial<EditableCard>>({});
  const [tagsInput, setTagsInput] = useState("");

  useEffect(() => {
    if (!card) {
      setDraft({});
      setTagsInput("");
      return;
    }
    setDraft({
      ...card,
      back: card.type === "basic" ? card.back ?? card.extra : card.back,
      extra: card.type === "basic" ? null : card.extra,
    });
    setTagsInput(card.tags.join(", "));
  }, [card]);

  const disabled = saving || busy;
  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);
  const merged = useMemo(
    () => (card ? mergeEditableCard(card, draft) : null),
    [card, draft],
  );

  const saveSnapshot = useMemo(() => {
    if (!merged) return "";
    return cardUpdateSnapshot({
      type: merged.type,
      front: merged.front,
      back: merged.back,
      cloze_text: merged.cloze_text,
      extra: merged.extra,
      tags,
    });
  }, [merged, tags]);

  const persist = useCallback(async () => {
    if (!merged) return;
    await onSave(merged, tags);
  }, [merged, tags, onSave]);

  const { status: saveStatus, error: saveError } = useAutoSaveCard({
    cardId: card?.id ?? null,
    snapshot: saveSnapshot,
    enabled: Boolean(card) && !disabled,
    save: persist,
  });

  return (
    <aside style={s.pane}>
      {!card ? (
        <div style={s.empty}>
          <i className="ri-stack-line" style={{ fontSize: 32, color: "var(--ink-300)" }} />
          <p style={s.emptyText}>Generate cards or select one to edit</p>
        </div>
      ) : (
        <>
      <div style={s.header}>
        <div>
          <div style={s.title}>{deckName ?? "New deck"}</div>
          <div style={s.subtitle}>{cardTypeLabel(card.type)} card</div>
        </div>
        <div style={s.headerRight}>
          <CardSaveStatus status={saveStatus} error={saveError} />
          <span className={`chip ${card.type === "cloze" ? "chip-due" : "chip-new"}`}>
            {cardTypeLabel(card.type, "short")}
          </span>
        </div>
      </div>

      <div style={s.fields}>
        <CardFieldEditor
          key={`${card.id}-front`}
          label="Front"
          cardId={card.id}
          allowCloze={card.type === "cloze"}
          value={card.type === "cloze" ? (draft.cloze_text ?? "") : (draft.front ?? "")}
          onChange={(v) =>
            setDraft((d) =>
              card.type === "cloze" ? { ...d, cloze_text: v } : { ...d, front: v },
            )
          }
          placeholder={
            card.type === "cloze"
              ? "Cloze text — select text and use C or C1/C2/C3"
              : "Question"
          }
          disabled={disabled}
        />
        <CardFieldEditor
          key={`${card.id}-back`}
          label="Back"
          cardId={card.id}
          value={card.type === "cloze" ? (draft.extra ?? "") : basicBackValue(card, draft)}
          onChange={(v) =>
            setDraft((d) =>
              card.type === "cloze" ? { ...d, extra: v } : { ...d, back: v, extra: null },
            )
          }
          placeholder={card.type === "cloze" ? "Answer shown on reveal" : "Answer"}
          disabled={disabled}
        />

        <CardTagsEditor
          key={card.id}
          value={tagsInput}
          onChange={setTagsInput}
          disabled={disabled}
        />
      </div>

      <div style={s.actions}>
        {onDelete ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={disabled}
            onClick={() => void onDelete()}
          >
            <i className="ri-delete-bin-line" />
            Delete
          </button>
        ) : (
          <span />
        )}
      </div>
        </>
      )}
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  pane: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    overflow: "hidden",
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 32,
    textAlign: "center",
  },
  emptyText: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "16px 18px",
    borderBottom: "1px solid var(--border-1)",
  },
  headerRight: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
  },
  title: {
    font: "600 15px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  subtitle: {
    marginTop: 4,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  fields: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    padding: "16px 18px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  actions: {
    display: "flex",
    justifyContent: "space-between",
    gap: 8,
    padding: "12px 18px",
    borderTop: "1px solid var(--border-1)",
  },
};
