"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type ImageOcclusionData } from "@deephaus/shared";
import { CardFieldEditor } from "@/components/card-field-editor";
import { CardTypeBadge } from "@/components/card-type-badge";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import { CardSaveStatus } from "@/components/card-save-status";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
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
};

type PanelMode = "edit" | "explain";

type Props = {
  mode: PanelMode;
  card: StudyCardData;
  onClose: () => void;
  onSaved: (updated: StudyCardData) => void;
};

export function StudyCardPanel({ mode, card, onClose, onSaved }: Props) {
  const [draft, setDraft] = useState<StudyCardData>(card);
  const [explanation, setExplanation] = useState<string | null>(null);
  const [explainError, setExplainError] = useState<string | null>(null);
  const [explainLoading, setExplainLoading] = useState(false);

  useEffect(() => {
    setDraft({
      ...card,
      back: card.type === "basic" ? card.back ?? card.extra : card.back,
      extra: card.type === "basic" ? null : card.extra,
    });
    setExplanation(null);
    setExplainError(null);
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
    if (mode !== "explain") return;

    let cancelled = false;
    setExplainLoading(true);
    setExplainError(null);

    void (async () => {
      try {
        const res = await fetch(`/api/cards/${card.id}/explain`, { method: "POST" });
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { explanation: string };
        if (!cancelled) setExplanation(data.explanation);
      } catch (err) {
        if (!cancelled) {
          setExplainError(
            !navigator.onLine
              ? "Explain needs a connection."
              : err instanceof Error
                ? err.message
                : "Failed to load explanation",
          );
        }
      } finally {
        if (!cancelled) setExplainLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, card.id]);

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

  return (
    <aside
      className="dh-panel dh-study__panel"
      aria-label={mode === "edit" ? "Edit card" : "Explain"}
    >
      <div className="dh-panel__head">
        {mode === "edit" ? (
          <>
            <i className="ri-pencil-line dh-study__panel-icon" aria-hidden />
            <span className="dh-study__panel-title">Edit card</span>
            <span className="dh-study__panel-badge">
              <CardTypeBadge type={draft.type} />
            </span>
            <CardSaveStatus status={saveStatus} error={saveError} onRetry={()=>{void flush().catch(()=>undefined);}} />
          </>
        ) : (
          <>
            <i className="ri-sparkling-2-line dh-study__panel-icon" aria-hidden />
            <span className="dh-study__panel-title">Explain</span>
            <span className="dh-pill dh-pill--outline">1 credit</span>
          </>
        )}
        <span className="dh-spacer" />
        <button type="button" className="dh-study__icon-btn" onClick={onClose} aria-label="Close">
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      {mode === "edit" ? (
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
      ) : (
        <div className="dh-panel__body dh-study__explain-body">
          {explainLoading && (
            <div className="dh-study__explain-loading">
              <SkeletonBar width="100%" height={14} />
              <SkeletonBar width="92%" height={14} />
              <SkeletonBar width="78%" height={14} />
              <SkeletonBar width="85%" height={14} />
            </div>
          )}
          {explainError && <div className="dh-study__error">{explainError}</div>}
          {explanation && !explainLoading && <CardContentRenderer content={explanation} />}
        </div>
      )}
    </aside>
  );
}
