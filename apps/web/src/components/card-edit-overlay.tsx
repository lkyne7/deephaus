"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { cardTypeLabel, type ImageOcclusionData } from "@deephaus/shared";
import { motionTokens, motionTransition } from "@/lib/motion";
import { CardFieldEditor } from "@/components/card-field-editor";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import {
  CardStudyPreviewLauncher,
  type CardStudyPreviewCard,
} from "@/components/card-study-preview";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { CardSaveStatus } from "@/components/card-save-status";
import { CardLinkedSource } from "@/components/card-editor/card-linked-source";
import { CardPanelMenu } from "@/components/card-editor/card-panel-menu";
import { useCardRewrite, type CardContentFields } from "@/components/card-editor/card-rewrite";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";
// The editor looks the same here as on the Cards and Study pages.
import "@/components/workbench/workbench.css";
import "@/components/browse/cards.css";

export type OverlayCard = {
  id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: ImageOcclusionData | unknown | null;
  tags: string[];
  source_ref?: string | null;
  /** Verbatim excerpt of the source passage this card was generated from. */
  source_quote?: string | null;
};

type Props = {
  open: boolean;
  card: OverlayCard | null;
  cardIndex?: number;
  busy?: boolean;
  onClose: () => void;
  onSaved: (updated: OverlayCard) => void;
  onDelete?: () => void | Promise<void>;
  /** Jump to the card's linked source document (and optional snippet). */
  onViewSource?: (target: { sourceId: string; snippet: string }) => void;
  /** When true, show an Unlink action in the linked-source section (Create page). */
  allowUnlinkSource?: boolean;
};

function basicBackValue(card: OverlayCard, draft: Partial<OverlayCard>): string {
  return draft.back ?? card.back ?? card.extra ?? "";
}

/** Inner content mounts only while open so the auto-save hook flushes on close. */
function OverlayContent({
  card,
  cardIndex = -1,
  busy = false,
  onClose,
  onSaved,
  onDelete,
  onViewSource,
  allowUnlinkSource = false,
}: {
  card: OverlayCard;
  cardIndex?: number;
  busy?: boolean;
  onClose: () => void;
  onSaved: (updated: OverlayCard) => void;
  onDelete?: () => void | Promise<void>;
  onViewSource?: (target: { sourceId: string; snippet: string }) => void;
  allowUnlinkSource?: boolean;
}) {
  const [draft, setDraft] = useState<Partial<OverlayCard>>(() => ({
    ...card,
    back: card.type === "basic" ? card.back ?? card.extra : card.back,
    extra: card.type === "basic" ? null : card.extra,
  }));
  const [tagsInput, setTagsInput] = useState(() => (card.tags ?? []).join(", "));
  const [sourceQuote, setSourceQuote] = useState(card.source_quote ?? null);
  const [sourceRef, setSourceRef] = useState(card.source_ref ?? null);

  // Card type is fixed after creation — switching types corrupts field data.
  const cardType = card.type;
  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);

  const merged = useMemo<OverlayCard>(() => {
    return {
      ...card,
      ...draft,
      type: cardType,
      front: draft.front ?? card.front,
      back: cardType === "basic" ? basicBackValue(card, draft) : draft.back ?? card.back,
      cloze_text: draft.cloze_text ?? card.cloze_text,
      extra: cardType === "basic" ? null : draft.extra ?? card.extra,
      occlusion_data: draft.occlusion_data ?? card.occlusion_data ?? null,
      tags,
      source_ref: sourceRef,
      source_quote: sourceQuote,
    };
  }, [card, cardType, draft, tags, sourceRef, sourceQuote]);

  const handleSourceUnlinked = useCallback(() => {
    setSourceQuote(null);
    setSourceRef(null);
    onSaved({
      id: card.id,
      type: merged.type,
      front: merged.front,
      back: merged.back,
      cloze_text: merged.cloze_text,
      extra: merged.extra,
      occlusion_data: merged.occlusion_data,
      tags: merged.tags,
      source_ref: null,
      source_quote: null,
    });
  }, [card.id, merged, onSaved]);

  const previewCard = useMemo<CardStudyPreviewCard>(
    () => ({
      type: merged.type,
      front: merged.type === "cloze" ? null : merged.front,
      back: merged.back,
      cloze_text: merged.type === "cloze" ? merged.cloze_text : null,
      extra: merged.type === "basic" ? null : merged.extra,
      occlusion_data: merged.type === "image-occlusion" ? merged.occlusion_data : undefined,
      tags,
    }),
    [merged, tags],
  );

  const snapshot = useMemo(
    () =>
      cardUpdateSnapshot({
        type: merged.type,
        front: merged.front,
        back: merged.back,
        cloze_text: merged.cloze_text,
        extra: merged.extra,
        occlusion_data: merged.occlusion_data as ImageOcclusionData | null | undefined,
        tags,
      }),
    [merged, tags],
  );

  const persist = useCallback(async (isCurrent:()=>boolean=()=>true) => {
    const body = buildCardUpdateBody({
      type: merged.type,
      front: merged.front,
      back: merged.back,
      cloze_text: merged.cloze_text,
      extra: merged.extra,
      occlusion_data: merged.occlusion_data as ImageOcclusionData | null | undefined,
      tags,
    });
    const saved = await updateCardApi<OverlayCard>(card.id, body);
    if(!isCurrent()) return;
    onSaved({ ...merged, ...saved, tags });
  }, [card.id, merged, tags, onSaved]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: card.id,
    snapshot,
    enabled: !busy,
    onRestore: (value) => { const restored = JSON.parse(value); setDraft(previous=>({...previous,...restored})); setTagsInput((restored.tags ?? []).join(", ")); },
    save: persist,
  });

  const handleClose = useCallback(() => {
    void flush();
    onClose();
  }, [flush, onClose]);

  const rewriteFields = useMemo<CardContentFields>(
    () => ({
      front: merged.front,
      back: merged.back,
      cloze_text: merged.cloze_text,
      extra: merged.extra,
    }),
    [merged.front, merged.back, merged.cloze_text, merged.extra],
  );

  const applyRewrite = useCallback(
    (fields: CardContentFields, source: "rewrite" | "undo") => {
      setDraft((d) => ({ ...d, ...fields }));
      // The server already saved a rewrite; an undo is saved by auto-save.
      if (source === "rewrite") onSaved({ ...merged, ...fields, tags });
    },
    [merged, onSaved, tags],
  );

  const rewrite = useCardRewrite({
    cardId: card.id,
    cardType,
    current: rewriteFields,
    flush,
    apply: applyRewrite,
    disabled: busy,
  });

  return (
    <>
      <div className="dh-panel__head dh-bench-panel__head">
        <div className="dh-bench-panel__heading">
          <div className="dh-bench-panel__title">{cardIndex >= 0 ? `Card ${cardIndex + 1}` : "Edit card"}</div>
          <div className="dh-bench-panel__sub">{cardTypeLabel(cardType, "short")}</div>
        </div>
        <span className="dh-spacer" />
        <CardStudyPreviewLauncher card={previewCard} disabled={busy} compact />
        <CardPanelMenu
          disabled={busy}
          rewrite={rewrite.supported ? rewrite : undefined}
          onDelete={onDelete ? () => void onDelete() : undefined}
        />
        <button type="button" className="dh-bench-iconbtn" onClick={handleClose} aria-label="Close" title="Close">
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      {rewrite.notice}

      <div className="dh-panel__body dh-cards-panel__body">
        {cardType === "image-occlusion" ? (
          <ImageOcclusionCardSection
            key={`${card.id}-image-occlusion`}
            cardId={card.id}
            front={draft.front ?? card.front ?? ""}
            back={draft.back ?? card.back ?? ""}
            occlusionData={draft.occlusion_data ?? card.occlusion_data ?? null}
            disabled={busy}
            onChange={(patch) =>
              setDraft((d) => ({
                ...d,
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
              disabled={busy}
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
              disabled={busy}
            />
          </>
        )}

        <CardTagsEditor value={tagsInput} onChange={setTagsInput} disabled={busy} variant="pills" />

        <CardLinkedSource
          key={`${card.id}-source`}
          cardId={card.id}
          quote={sourceQuote}
          sourceRef={sourceRef}
          onViewSource={onViewSource}
          allowUnlink={allowUnlinkSource}
          onUnlinked={handleSourceUnlinked}
        />
      </div>

      <div className="dh-panel__foot dh-bench-panel__foot">
        <CardSaveStatus
          status={saveStatus === "idle" ? "saved" : saveStatus}
          error={saveError}
          onRetry={() => {
            void flush().catch(() => undefined);
          }}
        />
      </div>
    </>
  );
}

/** The card editor as a floating sheet over the page (Create, deck Cards tab). */
export function CardEditOverlay({
  open,
  card,
  cardIndex,
  busy,
  onClose,
  onSaved,
  onDelete,
  onViewSource,
  allowUnlinkSource,
}: Props) {
  const reducedMotion = useReducedMotion();
  // Rendered on <body> so the sheet sits above the app sidebar, not inside the page.
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  useEffect(() => setPortalTarget(document.body), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!portalTarget) return null;

  return createPortal(
    <AnimatePresence>
      {open && card ? (
        <m.div
          key="card-overlay"
          className="dh-card-sheet"
          onMouseDown={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition(motionTokens.duration.fast, undefined, reducedMotion ?? false)}
        >
          <m.aside
            className="dh-panel dh-panel--float dh-cards-panel dh-card-sheet__panel"
            role="dialog"
            aria-label="Edit card"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ x: "calc(100% + 24px)" }}
            animate={{ x: 0 }}
            exit={{ x: "calc(100% + 24px)" }}
            transition={motionTransition(motionTokens.duration.base, undefined, reducedMotion ?? false)}
          >
            <OverlayContent
              key={card.id}
              card={card}
              cardIndex={cardIndex}
              busy={busy}
              onClose={onClose}
              onSaved={onSaved}
              onDelete={onDelete}
              onViewSource={onViewSource}
              allowUnlinkSource={allowUnlinkSource}
            />
          </m.aside>
        </m.div>
      ) : null}
    </AnimatePresence>,
    portalTarget,
  );
}
