"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  type CardSourceLocation,
  type ImageOcclusionData,
} from "@deephaus/shared";
import { motionTokens, motionTransition } from "@/lib/motion";
import { CardFieldEditor } from "@/components/card-field-editor";
import { ImageOcclusionCardSection } from "@/components/image-occlusion/image-occlusion-card-section";
import {
  CardStudyPreviewLauncher,
  type CardStudyPreviewCard,
} from "@/components/card-study-preview";
import { CardTypeBadge } from "@/components/card-type-badge";
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { CardSaveStatus } from "@/components/card-save-status";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, unlinkCardFromSourceApi, updateCardApi } from "@/lib/cards/update";

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
  deckName?: string;
  cardIndex?: number;
  busy?: boolean;
  onClose: () => void;
  onSaved: (updated: OverlayCard) => void;
  onDelete?: () => void | Promise<void>;
  onViewSource?: (snippet: string) => void;
  /** When true, show an Unlink action in the linked-source panel (Create page). */
  allowUnlinkSource?: boolean;
};

function truncate(text: string, max = 200): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function basicBackValue(card: OverlayCard, draft: Partial<OverlayCard>): string {
  return draft.back ?? card.back ?? card.extra ?? "";
}

/** Compact "Linked source" preview with jump-to-source and optional unlink. */
function LinkedSource({
  cardId,
  quote,
  sourceRef,
  onViewSource,
  allowUnlink,
  onUnlinked,
}: {
  cardId: string;
  /** The card's own verbatim evidence quote (preferred over the chunk text). */
  quote?: string | null;
  sourceRef?: string | null;
  onViewSource?: (snippet: string) => void;
  allowUnlink?: boolean;
  onUnlinked?: () => void;
}) {
  const [data, setData] = useState<CardSourceLocation | null>(null);
  const [unlinking, setUnlinking] = useState(false);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  /** Hide immediately after a successful unlink so the panel doesn't flash. */
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setCleared(false);
    setUnlinkError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/cards/${cardId}/source`, { credentials: "include" });
        if (res.ok) {
          const json = (await res.json()) as CardSourceLocation;
          if (!cancelled) setData(json);
        }
      } catch {
        // Best-effort; no linked source on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // Prefer the card's exact evidence quote; fall back to the chunk excerpt.
  const snippet = (quote ?? "").trim() || data?.content || "";
  const hasLink = Boolean(snippet || (sourceRef ?? "").trim() || data?.label);

  if (cleared || !hasLink) return null;

  async function handleUnlink() {
    if (unlinking) return;
    setUnlinking(true);
    setUnlinkError(null);
    try {
      await unlinkCardFromSourceApi(cardId);
      setCleared(true);
      onUnlinked?.();
    } catch (err) {
      setUnlinkError(err instanceof Error ? err.message : "Could not unlink from source.");
    } finally {
      setUnlinking(false);
    }
  }

  return (
    <div style={s.linked}>
      <div style={s.linkedHead}>
        <span style={s.linkedLabel}>Linked source</span>
        <div style={s.linkedActions}>
          {onViewSource ? (
            <button type="button" style={s.linkedView} onClick={() => onViewSource(snippet)}>
              View in source
              <i className="ri-arrow-right-up-line" />
            </button>
          ) : data?.externalUrl ? (
            <a href={data.externalUrl} target="_blank" rel="noopener noreferrer" style={s.linkedView}>
              Open original
              <i className="ri-external-link-line" />
            </a>
          ) : null}
          {allowUnlink ? (
            <button
              type="button"
              style={{
                ...s.linkedUnlink,
                ...(unlinking ? s.linkedUnlinkDisabled : {}),
              }}
              onClick={() => void handleUnlink()}
              disabled={unlinking}
              title="Remove the link between this card and the source passage"
            >
              <i className={unlinking ? "ri-loader-4-line icon-spin" : "ri-link-unlink"} aria-hidden />
              {unlinking ? "Unlinking…" : "Unlink"}
            </button>
          ) : null}
        </div>
      </div>
      <div style={s.linkedBox}>
        {data?.label || sourceRef ? (
          <div style={s.linkedRef}>{data?.label ?? sourceRef}</div>
        ) : null}
        {snippet ? <p style={s.linkedQuote}>“{truncate(snippet, 240)}”</p> : null}
      </div>
      {unlinkError ? <p style={s.linkedError}>{unlinkError}</p> : null}
    </div>
  );
}

/** Inner content mounts only while open so the auto-save hook flushes on close. */
function OverlayContent({
  card,
  deckName,
  cardIndex = -1,
  busy = false,
  onClose,
  onSaved,
  onDelete,
  onViewSource,
  allowUnlinkSource = false,
}: {
  card: OverlayCard;
  deckName?: string;
  cardIndex?: number;
  busy?: boolean;
  onClose: () => void;
  onSaved: (updated: OverlayCard) => void;
  onDelete?: () => void | Promise<void>;
  onViewSource?: (snippet: string) => void;
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

  const persist = useCallback(async () => {
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
    onSaved({ ...merged, ...saved, tags });
  }, [card.id, merged, tags, onSaved]);

  const { status: saveStatus, error: saveError, flush } = useAutoSaveCard({
    cardId: card.id,
    snapshot,
    enabled: !busy,
    save: persist,
  });

  const handleClose = useCallback(() => {
    void flush();
    onClose();
  }, [flush, onClose]);

  return (
    <>
      <div style={s.header}>
        <div style={s.headerTop}>
          <div style={s.titleWrap}>
            <span style={s.title}>{cardIndex >= 0 ? `Card #${cardIndex + 1}` : "Card"}</span>
            {deckName ? <span style={s.deckName}>{deckName}</span> : null}
          </div>
          <div style={s.headerActions}>
            <CardStudyPreviewLauncher card={previewCard} disabled={busy} compact />
            <button
              type="button"
              style={s.iconBtn}
              onClick={handleClose}
              aria-label="Close"
              title="Close"
            >
              <i className="ri-close-line" />
            </button>
          </div>
        </div>
        <div style={s.typeRow}>
          <CardTypeBadge type={cardType} />
        </div>
      </div>

      <div style={s.body}>
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

        <LinkedSource
          key={`${card.id}-source`}
          cardId={card.id}
          quote={sourceQuote}
          sourceRef={sourceRef}
          onViewSource={onViewSource}
          allowUnlink={allowUnlinkSource}
          onUnlinked={handleSourceUnlinked}
        />

        <CardTagsEditor value={tagsInput} onChange={setTagsInput} disabled={busy} />
      </div>

      <div style={s.footer}>
        <div style={s.footerLeft}>
          {onDelete ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ color: "var(--grade-again)" }}
              disabled={busy}
              onClick={() => void onDelete()}
            >
              <i className="ri-delete-bin-line" />
              Delete
            </button>
          ) : null}
        </div>
        <CardSaveStatus status={saveStatus} error={saveError} />
      </div>
    </>
  );
}

/** Right slide-in overlay for editing a card and viewing its exact source. */
export function CardEditOverlay({
  open,
  card,
  deckName,
  cardIndex,
  busy,
  onClose,
  onSaved,
  onDelete,
  onViewSource,
  allowUnlinkSource,
}: Props) {
  const reducedMotion = useReducedMotion();

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

  return (
    <AnimatePresence>
      {open && card ? (
        <m.div
          key="card-overlay"
          style={s.overlay}
          onMouseDown={onClose}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition(motionTokens.duration.fast, undefined, reducedMotion ?? false)}
        >
          <m.aside
            style={s.panel}
            role="dialog"
            aria-label="Edit card"
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={motionTransition(motionTokens.duration.base, undefined, reducedMotion ?? false)}
          >
            <OverlayContent
              key={card.id}
              card={card}
              deckName={deckName}
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
    </AnimatePresence>
  );
}

const s: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 60,
    background: "var(--bg-overlay)",
    display: "flex",
    justifyContent: "flex-end",
  },
  panel: {
    width: "min(460px, 100vw)",
    height: "100%",
    background: "var(--white)",
    borderLeft: "1px solid var(--border-2)",
    boxShadow: "var(--shadow-xl)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: "14px 18px 12px",
    borderBottom: "1px solid var(--border-1)",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  titleWrap: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    minWidth: 0,
  },
  title: {
    font: "600 15px/20px var(--font-sans)",
    color: "var(--ink-900)",
    flexShrink: 0,
  },
  deckName: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  headerActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
  },
  iconBtn: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 30,
    height: 30,
    padding: 0,
    background: "transparent",
    border: "1px solid transparent",
    borderRadius: 8,
    color: "var(--ink-500)",
    cursor: "pointer",
  },
  typeRow: {
    display: "flex",
    alignItems: "center",
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 18,
  },
  linked: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  linkedHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  linkedActions: {
    display: "inline-flex",
    alignItems: "center",
    gap: 12,
    flexShrink: 0,
  },
  linkedLabel: {
    font: "600 11px/16px var(--font-sans)",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    color: "var(--fg-4)",
  },
  linkedView: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "none",
    padding: 0,
    color: "var(--teal-700)",
    font: "500 12px/16px var(--font-sans)",
    cursor: "pointer",
    textDecoration: "none",
  },
  linkedUnlink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    background: "transparent",
    border: "none",
    padding: 0,
    color: "var(--fg-4)",
    font: "500 12px/16px var(--font-sans)",
    cursor: "pointer",
  },
  linkedUnlinkDisabled: {
    opacity: 0.55,
    cursor: "not-allowed",
  },
  linkedBox: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 12px",
    background: "var(--brand-25)",
    borderLeft: "3px solid var(--teal-500)",
    borderRadius: 8,
  },
  linkedRef: {
    font: "600 11px/16px var(--font-sans)",
    letterSpacing: "0.03em",
    textTransform: "uppercase",
    color: "var(--teal-700)",
  },
  linkedQuote: {
    margin: 0,
    font: "400 13px/19px var(--font-sans)",
    color: "var(--ink-800)",
  },
  linkedError: {
    margin: 0,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--grade-again)",
  },
  footer: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    padding: "10px 14px",
    borderTop: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  footerLeft: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  },
};
