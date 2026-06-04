"use client";

import {
  cardMediaDisplayUrlSized,
  extractCardMediaUrls,
  extractClozeOrdinals,
  imageUrlFromCardFields,
  occlusionOrdinals,
  parseCardContent,
  parseImageOcclusionData,
} from "@deephaus/shared";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { StudyCardTags } from "@/components/study-card-tags";
import { motionTokens, motionTransition, scaleIn } from "@/lib/motion";
import {
  DEFAULT_STUDY_TEXT_SCALE_INDEX,
  STUDY_TEXT_SCALE_STEPS,
  studyCardTextStyle,
} from "@/lib/study/text-scale";
import "./card-study-preview.css";

export type CardStudyPreviewCard = {
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  tags?: string[];
};

type LauncherProps = {
  card: CardStudyPreviewCard;
  disabled?: boolean;
  /** Shorter control for editor sidebars */
  compact?: boolean;
};

export function previewThumbnailUrl(card: CardStudyPreviewCard): string | null {
  if (card.type === "image-occlusion") {
    const data = parseImageOcclusionData(card.occlusion_data);
    return (
      data?.imageUrl ??
      imageUrlFromCardFields(card.front, card.back ?? card.extra) ??
      null
    );
  }
  if (card.type === "cloze") {
    return extractCardMediaUrls(card.cloze_text, card.extra)[0] ?? null;
  }
  return extractCardMediaUrls(card.front, card.back, card.extra)[0] ?? null;
}

export function CardStudyPreviewLauncher({ card, disabled, compact }: LauncherProps) {
  const [open, setOpen] = useState(false);
  const thumbUrl = useMemo(() => previewThumbnailUrl(card), [card]);

  return (
    <>
      <button
        type="button"
        className={`card-study-preview-trigger${compact ? " card-study-preview-trigger--compact" : ""}`}
        disabled={disabled}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
      >
        {thumbUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cardMediaDisplayUrlSized(thumbUrl, "thumb")}
            alt=""
            className="card-study-preview-trigger-thumb"
          />
        ) : (
          <span
            className="card-study-preview-trigger-thumb card-study-preview-trigger-thumb--placeholder"
            aria-hidden
          >
            <i className="ri-eye-line" />
          </span>
        )}
        <span className="card-study-preview-trigger-label">
          <i className="ri-play-circle-line" aria-hidden />
          Preview
        </span>
      </button>
      <CardStudyPreviewOverlay
        card={card}
        open={open}
        onClose={() => setOpen(false)}
      />
    </>
  );
}

type OverlayProps = {
  card: CardStudyPreviewCard;
  open: boolean;
  onClose: () => void;
};

function CardStudyPreviewOverlay({ card, open, onClose }: OverlayProps) {
  const reducedMotion = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, handleKeyDown]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <m.div
          key="study-preview-overlay"
          className="card-study-preview-overlay"
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTransition(motionTokens.duration.fast, undefined, reducedMotion ?? false)}
          onMouseDown={onClose}
        >
          <m.div
            ref={dialogRef}
            className="card-study-preview-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Study preview"
            tabIndex={-1}
            variants={scaleIn}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={motionTransition(undefined, undefined, reducedMotion ?? false)}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <CardStudyPreviewContent card={card} onClose={onClose} />
          </m.div>
        </m.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}

function CardStudyPreviewContent({
  card,
  onClose,
}: {
  card: CardStudyPreviewCard;
  onClose: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const [clozeOrd, setClozeOrd] = useState(1);
  const [occlusionOrd, setOcclusionOrd] = useState(1);

  const textStyle = studyCardTextStyle(STUDY_TEXT_SCALE_STEPS[DEFAULT_STUDY_TEXT_SCALE_INDEX]);

  const clozeOrds = useMemo(
    () => (card.type === "cloze" ? extractClozeOrdinals(card.cloze_text) : []),
    [card.type, card.cloze_text],
  );

  const occlusionOrds = useMemo(() => {
    if (card.type !== "image-occlusion") return [];
    const data = parseImageOcclusionData(card.occlusion_data);
    return data ? occlusionOrdinals(data) : [];
  }, [card.type, card.occlusion_data]);

  useEffect(() => {
    setRevealed(false);
    setClozeOrd(1);
    setOcclusionOrd(1);
  }, [card.type, card.front, card.back, card.cloze_text, card.extra, card.occlusion_data]);

  useEffect(() => {
    if (clozeOrds.length > 0 && !clozeOrds.includes(clozeOrd)) {
      setClozeOrd(clozeOrds[0]!);
    }
  }, [clozeOrds, clozeOrd]);

  useEffect(() => {
    if (occlusionOrds.length > 0 && !occlusionOrds.includes(occlusionOrd)) {
      setOcclusionOrd(occlusionOrds[0]!);
    }
  }, [occlusionOrds, occlusionOrd]);

  const toggleReveal = useCallback(() => {
    setRevealed((value) => !value);
  }, []);

  /** Whether "Show answer" can reveal study content (matches reviewer, not just the back field). */
  const canReveal = useMemo(() => {
    if (card.type === "image-occlusion") {
      const data = parseImageOcclusionData(card.occlusion_data);
      return Boolean(data?.imageUrl || card.front?.trim());
    }
    if (card.type === "cloze") {
      return Boolean(card.cloze_text?.trim());
    }
    return Boolean(card.front?.trim());
  }, [card]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== " " && event.code !== "Space") return;
      event.preventDefault();
      event.stopPropagation();
      if (!canReveal) return;
      toggleReveal();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [canReveal, toggleReveal]);

  const showOrdPicker =
    (card.type === "cloze" && clozeOrds.length > 1) ||
    (card.type === "image-occlusion" && occlusionOrds.length > 1);

  const activeOrds = card.type === "cloze" ? clozeOrds : occlusionOrds;
  const activeOrd = card.type === "cloze" ? clozeOrd : occlusionOrd;

  function renderQuestion() {
    if (card.type === "image-occlusion") {
      const data = parseImageOcclusionData(card.occlusion_data);
      if (!data?.imageUrl) {
        return <p className="card-study-preview-empty">Add occlusion regions to preview study.</p>;
      }
      return (
        <>
          {parseCardContent(card.front ?? "")
            .filter((segment) => segment.type === "text" && segment.value.trim().length > 0)
            .map((segment, index) => (
              <span key={index} style={textStyle}>
                {segment.type === "text" ? segment.value.trim() : ""}
              </span>
            ))}
          <OcclusionRenderer
            data={data}
            activeOrd={occlusionOrds.length > 0 ? occlusionOrd : null}
            revealed={revealed}
            studyView
            className="card-study-preview-occlusion"
          />
        </>
      );
    }

    if (card.type === "cloze") {
      if (!card.cloze_text?.trim()) {
        return <p className="card-study-preview-empty">Add cloze text to preview study.</p>;
      }
      return (
        <div style={textStyle}>
          <CardContentRenderer
            content={card.cloze_text}
            clozeMode={revealed ? "revealed" : "hidden"}
            activeClozeOrd={clozeOrds.length > 0 ? clozeOrd : null}
            studyView
          />
        </div>
      );
    }

    if (!card.front?.trim()) {
      return <p className="card-study-preview-empty">Add a question to preview study.</p>;
    }

    return (
      <div style={textStyle}>
        <CardContentRenderer content={card.front} studyView />
      </div>
    );
  }

  function renderAnswer() {
    if (!revealed) return null;

    if (card.type === "cloze") {
      if (!card.extra?.trim()) return null;
      return (
        <div className="card-study-preview-answer">
          <div className="card-study-preview-divider" />
          <div style={textStyle}>
            <CardContentRenderer content={card.extra} studyView />
          </div>
        </div>
      );
    }

    const answer = card.back ?? card.extra;
    if (!answer?.trim()) return null;

    return (
      <div className="card-study-preview-answer">
        <div className="card-study-preview-divider" />
        <div style={textStyle}>
          <CardContentRenderer content={answer} studyView />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="card-study-preview-dialog-header">
        <span className="card-study-preview-dialog-title">Study preview</span>
        <div className="card-study-preview-dialog-header-actions">
          <div className="card-study-preview-controls">
            {showOrdPicker ? (
              <div className="card-study-preview-ord" role="group" aria-label="Preview mask">
                {activeOrds.map((ord) => (
                  <button
                    key={ord}
                    type="button"
                    className={`card-study-preview-ord-btn${ord === activeOrd ? " is-active" : ""}`}
                    onClick={() =>
                      card.type === "cloze" ? setClozeOrd(ord) : setOcclusionOrd(ord)
                    }
                    aria-pressed={ord === activeOrd}
                  >
                    {card.type === "cloze" ? `C${ord}` : ord}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onClose}
            aria-label="Close preview"
          >
            <i className="ri-close-line" />
          </button>
        </div>
      </div>

      <div className="card-study-preview-dialog-body">
        <div className="card-study-preview-face">
          <div className="card-study-preview-question study-card-question">{renderQuestion()}</div>
          <div className="study-card-answer">{renderAnswer()}</div>
          {card.tags && card.tags.length > 0 ? <StudyCardTags tags={card.tags} /> : null}
        </div>
        <div className="card-study-preview-dialog-footer">
          {canReveal ? (
            <button
              type="button"
              className={`btn btn-primary${revealed ? "" : " study-show-btn"}`}
              onClick={() => (revealed ? toggleReveal() : setRevealed(true))}
            >
              {!revealed ? (
                <span className="study-shortcut-popup" role="tooltip">
                  Space
                </span>
              ) : null}
              {revealed ? "Hide answer" : "Show answer"}
            </button>
          ) : (
            <span className="card-study-preview-hint">Add card content to preview</span>
          )}
        </div>
      </div>
    </>
  );
}
