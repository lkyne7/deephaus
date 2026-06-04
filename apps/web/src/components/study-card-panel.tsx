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

  const persistEdits = useCallback(async () => {
    const body = buildCardUpdateBody({
      type: draft.type,
      front: draft.front,
      back: draft.back,
      cloze_text: draft.cloze_text,
      extra: draft.extra,
      occlusion_data: draft.occlusion_data as ImageOcclusionData | null | undefined,
    });
    const saved = await updateCardApi<StudyCardData>(card.id, body);
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

  const { status: saveStatus, error: saveError } = useAutoSaveCard({
    cardId: mode === "edit" ? card.id : null,
    snapshot: saveSnapshot,
    enabled: mode === "edit",
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
          setExplainError(err instanceof Error ? err.message : "Failed to load explanation");
        }
      } finally {
        if (!cancelled) setExplainLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mode, card.id]);

  return (
    <div style={s.overlay} onMouseDown={onClose}>
      <aside
        style={s.panel}
        role="dialog"
        aria-label={mode === "edit" ? "Edit card" : "AI explanation"}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div style={s.header}>
          <div>
            <div style={s.titleRow}>
              <div style={s.title}>{mode === "edit" ? "Edit card" : "AI explainer"}</div>
              {mode === "edit" ? <CardSaveStatus status={saveStatus} error={saveError} /> : null}
            </div>
            <div style={s.subtitle}>
              {mode === "edit"
                ? "Changes save automatically."
                : "A deeper look at this card’s concept."}
            </div>
            {mode === "edit" ? (
              <div style={{ marginTop: 8 }}>
                <CardTypeBadge type={draft.type} />
              </div>
            ) : null}
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <i className="ri-close-line" />
          </button>
        </div>

        {mode === "edit" ? (
          <div style={s.body}>
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
                      ? "Cloze text — select text and use C or C1/C2/C3"
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
          <div style={s.body}>
            {explainLoading && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                <SkeletonBar width="100%" height={14} />
                <SkeletonBar width="92%" height={14} />
                <SkeletonBar width="78%" height={14} />
                <SkeletonBar width="85%" height={14} />
              </div>
            )}
            {explainError && <div style={s.error}>{explainError}</div>}
            {explanation && !explainLoading && (
              <div style={s.explainContent}>
                <CardContentRenderer content={explanation} />
              </div>
            )}
            <div style={s.actions}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    background: "var(--bg-overlay)",
    display: "flex",
    justifyContent: "flex-end",
  },
  panel: {
    width: "min(440px, 100vw)",
    height: "100%",
    background: "var(--white)",
    borderLeft: "1px solid var(--border-2)",
    boxShadow: "var(--shadow-xl)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    padding: "20px 20px 12px",
    borderBottom: "1px solid var(--border-1)",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  title: {
    font: "600 16px/22px var(--font-sans)",
    color: "var(--ink-900)",
  },
  subtitle: {
    marginTop: 4,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  body: {
    flex: 1,
    overflow: "auto",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 12,
  },
  actions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: "auto",
    paddingTop: 8,
  },
  error: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
    padding: "10px 12px",
    borderRadius: 8,
    background: "var(--grade-again-bg)",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    color: "var(--fg-3)",
    font: "400 14px/20px var(--font-sans)",
    padding: "24px 0",
  },
  explainContent: {
    font: "400 15px/24px var(--font-sans)",
    color: "var(--ink-800)",
  },
};
