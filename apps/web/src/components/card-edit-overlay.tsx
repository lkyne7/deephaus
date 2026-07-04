"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import {
  CARD_EDITOR_TYPE_OPTIONS,
  cardTypeChipClass,
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
import { CardTagsEditor, parseTagsInput } from "@/components/card-tags-editor";
import { CardSaveStatus } from "@/components/card-save-status";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";

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
  onDuplicate?: () => void | Promise<void>;
  onViewSource?: (snippet: string) => void;
};

function truncate(text: string, max = 200): string {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function basicBackValue(card: OverlayCard, draft: Partial<OverlayCard>): string {
  return draft.back ?? card.back ?? card.extra ?? "";
}

/** Compact "Linked source" preview with a jump-to-source action. */
function LinkedSource({
  cardId,
  quote,
  onViewSource,
}: {
  cardId: string;
  /** The card's own verbatim evidence quote (preferred over the chunk text). */
  quote?: string | null;
  onViewSource?: (snippet: string) => void;
}) {
  const [data, setData] = useState<CardSourceLocation | null>(null);

  useEffect(() => {
    let cancelled = false;
    setData(null);
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
  if (!snippet) return null;

  return (
    <div style={s.linked}>
      <div style={s.linkedHead}>
        <span style={s.linkedLabel}>Linked source</span>
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
      </div>
      <div style={s.linkedBox}>
        {data?.label ? <div style={s.linkedRef}>{data.label}</div> : null}
        <p style={s.linkedQuote}>“{truncate(snippet, 240)}”</p>
      </div>
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
  onDuplicate,
  onViewSource,
}: {
  card: OverlayCard;
  deckName?: string;
  cardIndex?: number;
  busy?: boolean;
  onClose: () => void;
  onSaved: (updated: OverlayCard) => void;
  onDelete?: () => void | Promise<void>;
  onDuplicate?: () => void | Promise<void>;
  onViewSource?: (snippet: string) => void;
}) {
  const [draft, setDraft] = useState<Partial<OverlayCard>>(() => ({
    ...card,
    back: card.type === "basic" ? card.back ?? card.extra : card.back,
    extra: card.type === "basic" ? null : card.extra,
  }));
  const [tagsInput, setTagsInput] = useState(() => (card.tags ?? []).join(", "));

  const cardType = (draft.type ?? card.type) as OverlayCard["type"];
  const tags = useMemo(() => parseTagsInput(tagsInput), [tagsInput]);

  const changeType = useCallback(
    (next: OverlayCard["type"]) => {
      setDraft((d) => {
        const current = d.type ?? card.type;
        if (next === current) return d;
        const patch: Partial<OverlayCard> = { ...d, type: next };
        // Carry text across a basic↔cloze switch so nothing is lost.
        if (next === "cloze" && !(d.cloze_text ?? card.cloze_text)) {
          patch.cloze_text = d.front ?? card.front ?? "";
        }
        if (next === "basic" && !(d.front ?? card.front)) {
          patch.front = d.cloze_text ?? card.cloze_text ?? "";
        }
        return patch;
      });
    },
    [card],
  );

  const merged = useMemo<OverlayCard>(() => {
    const type = draft.type ?? card.type;
    return {
      ...card,
      ...draft,
      type,
      front: draft.front ?? card.front,
      back: type === "basic" ? basicBackValue(card, draft) : draft.back ?? card.back,
      cloze_text: draft.cloze_text ?? card.cloze_text,
      extra: type === "basic" ? null : draft.extra ?? card.extra,
      occlusion_data: draft.occlusion_data ?? card.occlusion_data ?? null,
      tags,
    };
  }, [card, draft, tags]);

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
        <div style={s.typeChips} role="group" aria-label="Card type">
          {CARD_EDITOR_TYPE_OPTIONS.map((opt) => {
            const active = cardType === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                aria-pressed={active}
                disabled={busy}
                onClick={() => changeType(opt.value)}
                className={active ? cardTypeChipClass(opt.value) : "chip chip-neutral"}
                style={{ ...s.typeChip, ...(active ? s.typeChipActive : {}) }}
              >
                <i className={opt.icon} aria-hidden />
                {opt.shortLabel}
              </button>
            );
          })}
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
          quote={card.source_quote}
          onViewSource={onViewSource}
        />

        <CardTagsEditor value={tagsInput} onChange={setTagsInput} disabled={busy} />
      </div>

      <div style={s.footer}>
        <div style={s.footerLeft}>
          {onDuplicate ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => void onDuplicate()}
            >
              <i className="ri-file-copy-line" />
              Duplicate
            </button>
          ) : null}
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
  onDuplicate,
  onViewSource,
}: Props) {
  const reducedMotion = useReducedMotion();

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
              onDuplicate={onDuplicate}
              onViewSource={onViewSource}
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
  typeChips: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  typeChip: {
    cursor: "pointer",
    border: "1px solid transparent",
  },
  typeChipActive: {
    boxShadow: "inset 0 0 0 1px currentColor",
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
