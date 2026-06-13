"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { type ImageOcclusionData } from "@deephaus/shared";
import { CardFieldEditor } from "@/components/card-field-editor";
import { CardTypeBadge } from "@/components/card-type-badge";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import {
  CardStudyPreviewLauncher,
  type CardStudyPreviewCard,
} from "@/components/card-study-preview";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { CardSaveStatus } from "@/components/card-save-status";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { cardUpdateSnapshot } from "@/lib/cards/update";

export type EditableCard = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: ImageOcclusionData | unknown | null;
  tags: string[];
};

type Props = {
  card: EditableCard | null;
  deckName?: string;
  saving?: boolean;
  busy?: boolean;
  /** Shown when no card is selected (defaults to browse copy). */
  emptyMessage?: string;
  onSave: (draft: EditableCard, tags: string[]) => Promise<void>;
  onDelete?: () => Promise<void>;
};

function basicBackValue(card: EditableCard, draft: Partial<EditableCard>): string {
  return draft.back ?? card.back ?? card.extra ?? "";
}

function draftFromCard(card: EditableCard | null): Partial<EditableCard> {
  if (!card) return {};
  return {
    ...card,
    back: card.type === "basic" ? card.back ?? card.extra : card.back,
    extra: card.type === "basic" ? null : card.extra,
  };
}

function mergeEditableCard(card: EditableCard, draft: Partial<EditableCard>): EditableCard {
  const type = draft.type ?? card.type;
  return {
    ...card,
    ...draft,
    type,
    front: draft.front ?? card.front,
    back: type === "basic" ? basicBackValue(card, draft) : draft.back ?? card.back,
    cloze_text: draft.cloze_text ?? card.cloze_text,
    extra: type === "basic" ? null : draft.extra ?? card.extra,
    occlusion_data:
      type === "image-occlusion"
        ? (draft.occlusion_data ?? card.occlusion_data ?? null)
        : (draft.occlusion_data ?? card.occlusion_data),
  };
}

export function CardEditorPanel({
  card,
  deckName,
  saving = false,
  busy = false,
  emptyMessage = "Select a card to edit",
  onSave,
  onDelete,
}: Props) {
  const [draft, setDraft] = useState<Partial<EditableCard>>({});
  const [tagsInput, setTagsInput] = useState("");
  /** Sync draft state before mounting controlled field inputs (avoids undefined → string warnings). */
  const [inputsReady, setInputsReady] = useState(false);

  useLayoutEffect(() => {
    if (!card) {
      setDraft({});
      setTagsInput("");
      setInputsReady(false);
      return;
    }
    setDraft(draftFromCard(card));
    setTagsInput((card.tags ?? []).join(", "));
    setInputsReady(true);
  }, [card?.id]);

  const disabled = saving || busy;
  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);
  const merged = useMemo(
    () => (card ? mergeEditableCard(card, draft) : null),
    [card, draft],
  );

  const cardType = (draft.type ?? card?.type) as EditableCard["type"] | undefined;

  const previewCard = useMemo((): CardStudyPreviewCard | null => {
    if (!card || !merged) return null;
    const type = merged.type;
    return {
      type,
      front: type === "cloze" ? null : merged.front,
      back: merged.back,
      cloze_text: type === "cloze" ? merged.cloze_text : null,
      extra: type === "basic" ? null : merged.extra,
      occlusion_data: type === "image-occlusion" ? merged.occlusion_data : undefined,
      tags,
    };
  }, [card, merged, tags]);

  const saveSnapshot = useMemo(() => {
    if (!card) return "";
    const type = (draft.type ?? card.type) as EditableCard["type"];
    return cardUpdateSnapshot({
      type,
      front: draft.front ?? card.front,
      back: draft.back ?? card.back,
      cloze_text: draft.cloze_text ?? card.cloze_text,
      extra: draft.extra ?? card.extra,
      occlusion_data:
        (draft.occlusion_data as ImageOcclusionData | undefined) ??
        (card.occlusion_data as ImageOcclusionData | undefined) ??
        null,
      tags,
    });
  }, [card, draft, tags]);

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
        <div style={s.empty}>{emptyMessage}</div>
      ) : (
        <>
          <div style={s.editorScroll}>
          <div style={s.editorHeader}>
            <div style={s.editorHeaderTop}>
              <div style={s.editorHeading}>
                <div style={s.editorTitle}>{deckName ?? "New deck"}</div>
                <CardTypeBadge type={cardType ?? card.type} />
              </div>
              {previewCard ? (
                <CardStudyPreviewLauncher
                  key={card.id}
                  card={previewCard}
                  disabled={disabled}
                  compact
                />
              ) : null}
            </div>
          </div>

          {inputsReady && cardType === "image-occlusion" ? (
            <ImageOcclusionCardSection
              key={`${card.id}-image-occlusion`}
              cardId={card.id}
              front={draft.front ?? card.front ?? ""}
              back={draft.back ?? card.back ?? ""}
              occlusionData={draft.occlusion_data ?? card.occlusion_data ?? null}
              disabled={disabled}
              onChange={(patch) =>
                setDraft((d) => ({
                  ...d,
                  type: patch.type,
                  front: patch.front,
                  back: patch.back,
                  occlusion_data: patch.occlusion_data,
                  cloze_text: null,
                  extra: null,
                }))
              }
            />
          ) : inputsReady ? (
            <>
              <CardFieldEditor
                label="Front"
                cardId={card.id}
                allowCloze={cardType === "cloze"}
                value={
                  cardType === "cloze"
                    ? (draft.cloze_text ?? card.cloze_text ?? "")
                    : (draft.front ?? card.front ?? "")
                }
                onChange={(v) =>
                  setDraft((d) =>
                    cardType === "cloze" ? { ...d, cloze_text: v } : { ...d, front: v },
                  )
                }
                placeholder={
                  cardType === "cloze"
                    ? "Cloze text — select text and use C or C1/C2/C3"
                    : "Question"
                }
                disabled={disabled}
              />
              <CardFieldEditor
                label="Back"
                cardId={card.id}
                value={
                  cardType === "cloze"
                    ? (draft.extra ?? card.extra ?? "")
                    : basicBackValue(card, draft)
                }
                onChange={(v) =>
                  setDraft((d) =>
                    cardType === "cloze"
                      ? { ...d, extra: v }
                      : { ...d, back: v, extra: null },
                  )
                }
                placeholder={cardType === "cloze" ? "Answer shown on reveal" : "Answer"}
                disabled={disabled}
              />
            </>
          ) : null}

          {inputsReady ? (
            <CardTagsEditor
              value={tagsInput ?? ""}
              onChange={setTagsInput}
              disabled={disabled}
            />
          ) : null}
          </div>

          <div style={s.editorActions}>
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
            <div style={s.editorFooterMeta}>
              <CardSaveStatus status={saveStatus} error={saveError} />
            </div>
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
    height: "100%",
    boxSizing: "border-box",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
  },
  editorScroll: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 16,
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    color: "var(--fg-4)",
    font: "400 14px/20px var(--font-sans)",
    textAlign: "center",
  },
  editorHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  editorHeaderTop: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 10,
  },
  editorHeading: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    alignItems: "flex-start",
  },
  editorTitle: {
    minWidth: 0,
    maxWidth: "100%",
    font: "600 15px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  muted: {
    marginTop: 4,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  editorActions: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 16px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  editorFooterMeta: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexShrink: 0,
  },
};
