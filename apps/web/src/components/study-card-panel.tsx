"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cardTypeLabel, type CardFieldFix, type ImageOcclusionData } from "@deephaus/shared";
import { CardFieldEditor } from "@/components/card-field-editor";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { CardSaveStatus } from "@/components/card-save-status";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { CardLinkedSource } from "@/components/card-editor/card-linked-source";
import { CardPanelMenu } from "@/components/card-editor/card-panel-menu";
import { useCardRewrite, type CardContentFields } from "@/components/card-editor/card-rewrite";
import { ExplainPanel } from "@/components/study/explain-panel";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";
// The card fields look the same here as in the Cards page editor.
import "@/components/browse/cards.css";

export type StudyCardData = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: ImageOcclusionData | unknown | null;
  cloze_ord?: number | null;
  /** Present on queue cards; the editor leaves tags alone when it's missing. */
  tags?: string[];
};

type PanelMode = "edit" | "explain";

type Props = {
  mode: PanelMode;
  card: StudyCardData;
  onClose: () => void;
  onSaved: (updated: StudyCardData) => void;
  /** Explain mode: shows Hint until the answer is revealed. */
  revealed?: boolean;
  /** Write a hint or explanation unasked; off when the panel carried over from the last card. */
  autoWrite?: boolean;
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
  autoWrite = true,
  deckId,
  editPrefill,
  onOpenEdit,
}: Props) {
  const [draft, setDraft] = useState<StudyCardData>(() => withPrefill(card, editPrefill));
  // Carried over from the last card: it was already on screen, so it doesn't fade in again.
  const carried = autoWrite ? undefined : "";
  // The kind the panel was opened for; only that one is written without asking.
  // A panel carried over from the last card shows what is saved but writes nothing.
  const [requestedKind] = useState<"hint" | "explain" | null>(
    autoWrite ? (revealed ? "explain" : "hint") : null,
  );
  const hasTags = Array.isArray(card.tags);
  const [tagsInput, setTagsInput] = useState(() => (card.tags ?? []).join(", "));
  const tags = useMemo(() => (hasTags ? parseTagsInput(tagsInput) : undefined), [hasTags, tagsInput]);

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
        tags,
      }),
    [draft, tags],
  );

  const persistEdits = useCallback(async (isCurrent:()=>boolean=()=>true) => {
    const body = buildCardUpdateBody({
      type: draft.type,
      front: draft.front,
      back: draft.back,
      cloze_text: draft.cloze_text,
      extra: draft.extra,
      occlusion_data: draft.occlusion_data as ImageOcclusionData | null | undefined,
      tags,
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
      ...(tags ? { tags: saved.tags ?? tags } : {}),
    });
  }, [card.id, draft, onSaved, tags]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: mode === "edit" ? card.id : null,
    snapshot: saveSnapshot,
    enabled: mode === "edit",
    onRestore: (value) => {
      const restored = JSON.parse(value);
      setDraft((previous) => ({ ...previous, ...restored }));
      if (Array.isArray(restored.tags)) setTagsInput(restored.tags.join(", "));
    },
    save: persistEdits,
  });

  const rewriteFields = useMemo<CardContentFields>(
    () => ({ front: draft.front, back: draft.back, cloze_text: draft.cloze_text, extra: draft.extra }),
    [draft.front, draft.back, draft.cloze_text, draft.extra],
  );

  const applyRewrite = useCallback(
    (fields: CardContentFields, source: "rewrite" | "undo") => {
      setDraft((d) => ({ ...d, ...fields }));
      // The server already saved a rewrite; an undo is saved by auto-save.
      if (source === "rewrite") onSaved({ ...draft, ...fields });
    },
    [draft, onSaved],
  );

  const rewrite = useCardRewrite({
    cardId: card.id,
    cardType: draft.type,
    current: rewriteFields,
    flush,
    apply: applyRewrite,
    disabled: mode !== "edit",
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
      <aside
        className="dh-panel dh-panel--float dh-study__panel"
        aria-label={revealed ? "Explain" : "Hint"}
        data-carried={carried}
      >
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
    <aside
      className="dh-panel dh-panel--float dh-study__panel dh-cards-panel"
      aria-label="Edit card"
      data-carried={carried}
    >
      <div className="dh-panel__head dh-study__panel-head">
        <span className="dh-pill">Edit card</span>
        <span className="dh-spacer" />
        <CardPanelMenu rewrite={rewrite.supported ? rewrite : undefined} />
        <button type="button" className="dh-study__icon-btn" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      {rewrite.notice}

      <div className="dh-panel__body dh-cards-panel__body" data-study-keys="ignore">
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

            {hasTags ? <CardTagsEditor value={tagsInput} onChange={setTagsInput} variant="pills" /> : null}

            <CardLinkedSource key={`${card.id}-source`} cardId={card.id} deckId={deckId} />
      </div>

      <div className="dh-panel__foot dh-study__foot">
        <CardSaveStatus
          status={saveStatus === "idle" ? "saved" : saveStatus}
          error={saveError}
          onRetry={() => {
            void flush().catch(() => undefined);
          }}
        />
        <span className="dh-spacer" />
        <span>{cardTypeLabel(draft.type, "short")}</span>
      </div>
    </aside>
  );
}
