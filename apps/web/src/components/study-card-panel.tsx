"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type CardFieldFix, type ImageOcclusionData } from "@deephaus/shared";
import { CardFieldEditor } from "@/components/card-field-editor";
import { CardTypeBadge } from "@/components/card-type-badge";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { CardSaveStatus } from "@/components/card-save-status";
import { ExplainPanel } from "@/components/study/explain-panel";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";

export type StudyCardData = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: ImageOcclusionData | unknown | null;
  cloze_ord?: number | null;
};

type PanelMode = "edit" | "explain";

type Props = {
  mode: PanelMode;
  card: StudyCardData;
  onClose: () => void;
  onSaved: (updated: StudyCardData) => void;
  /** Explain mode: shows Hint until the answer is revealed. */
  revealed?: boolean;
  /** The deck, for Explain's "Show in source" link. */
  deckId?: string | null;
  /** Edit mode: field changes to start from, e.g. a fix Explain suggested. */
  editPrefill?: CardFieldFix | null;
  /** Explain mode: switch to the Edit panel with a suggested fix filled in. */
  onOpenEdit?: (fix: CardFieldFix) => void;
};

function withPrefill(card: StudyCardData, prefill: CardFieldFix | null | undefined): StudyCardData {
  const base = {
    ...card,
    back: card.type === "basic" ? card.back ?? card.extra : card.back,
    extra: card.type === "basic" ? null : card.extra,
  };
  if (!prefill) return base;
  const next = { ...base };
  for (const key of ["front", "back", "cloze_text", "extra"] as const) {
    if (typeof prefill[key] === "string") next[key] = prefill[key] as string;
  }
  return next;
}

export function StudyCardPanel({
  mode,
  card,
  onClose,
  onSaved,
  revealed = true,
  deckId,
  editPrefill,
  onOpenEdit,
}: Props) {
  const [draft, setDraft] = useState<StudyCardData>(() => withPrefill(card, editPrefill));
  // The kind the panel was opened for; only that one is written without asking.
  const [requestedKind] = useState<"hint" | "explain">(revealed ? "explain" : "hint");

  useEffect(() => {
    setDraft(withPrefill(card, editPrefill));
    // Prefill applies when the panel opens or the card changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card]);

  const saveSnapshot = useMemo(
    () =>
      cardUpdateSnapshot({
        type: draft.type,
        front: draft.front,
        back: draft.back,
        cloze_text: draft.cloze_text,
        extra: draft.extra,
        occlusion_data: draft.occlusion_data as ImageOcclusionData | null | undefined,
      }),
    [draft],
  );

  const persistEdits = useCallback(async (isCurrent:()=>boolean=()=>true) => {
    const body = buildCardUpdateBody({
      type: draft.type,
      front: draft.front,
      back: draft.back,
      cloze_text: draft.cloze_text,
      extra: draft.extra,
      occlusion_data: draft.occlusion_data as ImageOcclusionData | null | undefined,
    });
    const saved = await updateCardApi<StudyCardData>(card.id, body);
    if(!isCurrent()) return;
    onSaved({
      id: saved.id,
      type: saved.type,
      front: saved.front,
      back: saved.back,
      cloze_text: saved.cloze_text,
      extra: saved.extra,
      occlusion_data: saved.occlusion_data ?? null,
    });
  }, [card.id, draft, onSaved]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: mode === "edit" ? card.id : null,
    snapshot: saveSnapshot,
    enabled: mode === "edit",
    onRestore: (value) => setDraft((previous) => ({ ...previous, ...JSON.parse(value) })),
    save: persistEdits,
  });

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (mode === "explain") {
    return (
      <aside className="dh-panel dh-study__panel" aria-label={revealed ? "Explain" : "Hint"}>
        <ExplainPanel
          card={card}
          revealed={revealed}
          requestedKind={requestedKind}
          deckId={deckId}
          onClose={onClose}
          onOpenEdit={onOpenEdit}
          onCardFixed={(fix) => {
            const { id: _id, ...fields } = fix;
            onSaved({ ...card, ...fields } as StudyCardData);
          }}
        />
      </aside>
    );
  }

  return (
    <aside className="dh-panel dh-study__panel" aria-label="Edit card">
      <div className="dh-panel__head">
        <i className="ri-pencil-line dh-study__panel-icon" aria-hidden />
        <span className="dh-study__panel-title">Edit card</span>
        <span className="dh-study__panel-badge">
          <CardTypeBadge type={draft.type} />
        </span>
        <CardSaveStatus status={saveStatus} error={saveError} onRetry={()=>{void flush().catch(()=>undefined);}} />
        <span className="dh-spacer" />
        <button type="button" className="dh-study__icon-btn" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body dh-study__panel-edit">
            {draft.type === "image-occlusion" ? (
              <ImageOcclusionCardSection
                key={card.id}
                cardId={card.id}
                front={draft.front ?? ""}
                back={draft.back ?? ""}
                occlusionData={draft.occlusion_data ?? null}
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
            ) : (
              <>
                <CardFieldEditor
                  label="Front"
                  cardId={card.id}
                  allowCloze={draft.type === "cloze"}
                  value={draft.type === "cloze" ? (draft.cloze_text ?? "") : (draft.front ?? "")}
                  onChange={(value) =>
                    setDraft((d) =>
                      d.type === "cloze" ? { ...d, cloze_text: value } : { ...d, front: value },
                    )
                  }
                  placeholder={
                    draft.type === "cloze"
                      ? "Cloze text: select text and use C or C1/C2/C3"
                      : "Question"
                  }
                />
                <CardFieldEditor
                  label="Back"
                  cardId={card.id}
                  value={
                    draft.type === "cloze"
                      ? (draft.extra ?? "")
                      : (draft.back ?? draft.extra ?? "")
                  }
                  onChange={(value) =>
                    setDraft((d) =>
                      d.type === "cloze"
                        ? { ...d, extra: value }
                        : { ...d, back: value, extra: null },
                    )
                  }
                  placeholder={
                    draft.type === "cloze" ? "Answer shown on reveal" : "Answer"
                  }
                />
              </>
            )}
        </div>
    </aside>
  );
}
