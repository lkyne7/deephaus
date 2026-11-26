"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, m, useReducedMotion } from "motion/react";
import { parseCardContent, parseImageOcclusionData } from "@deephaus/shared";
import { FadeIn } from "@/components/motion/fade-in";
import { OcclusionRenderer } from "@/components/image-occlusion/occlusion-renderer";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import {
  STUDY_ACTION_SHORTCUTS,
  STUDY_GRADES,
  type StudyGradeId,
} from "@/components/study-review-chrome";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { motionTransition, studyCardSwap } from "@/lib/motion";
import {
  clampStudyTextScaleIndex,
  STUDY_TEXT_SCALE_STEPS,
  studySessionTextVars,
} from "@/lib/study/text-scale";
import "@/components/rich-text/rich-text.css";
import "./study.css";

export type StudyPanelMode = "edit" | "explain";

/** Session frame: header, card area, dock and optional side panel. */
export function StudyFrame({
  header,
  notices,
  card,
  dock,
  meta,
  panel,
  aboveDock,
}: {
  header: ReactNode;
  notices?: ReactNode;
  card: ReactNode;
  dock: ReactNode;
  meta: ReactNode;
  panel?: ReactNode;
  /** A transient row just above the dock, such as the missed-card pill. */
  aboveDock?: ReactNode;
}) {
  return (
    <div className="dh-study" data-panel={panel ? "open" : undefined}>
      <div className="dh-study__main">
        {header}
        {notices}
        <div className="dh-study__mid">{card}</div>
        <div className="dh-study__dock-wrap">
          {aboveDock}
          <div className="dh-study__dock">{dock}</div>
          {meta}
        </div>
      </div>
      {panel}
    </div>
  );
}

export function StudyHeader({
  backHref,
  backLabel,
  title,
  position,
  progress,
  panelMode,
  onPanelChange,
  revealed = true,
  more,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  position: string;
  /** 0-100; the bar in the middle of the header. */
  progress: number;
  panelMode: StudyPanelMode | null;
  onPanelChange: (mode: StudyPanelMode | null) => void;
  /** Before the answer is shown the AI button offers a Hint instead of Explain. */
  revealed?: boolean;
  more: ReactNode;
}) {
  const aiLabel = revealed ? "Explain" : "Hint";
  return (
    <header className="dh-study__top">
      <div className="dh-study__bar">
        <div className="dh-study__where">
          <Link href={backHref} className="dh-study__icon-btn" aria-label={backLabel} title={backLabel}>
            <i className="ri-arrow-left-line" aria-hidden />
          </Link>
          <div className="dh-study__heading">
            <span className="dh-study__title" title={title}>
              {title}
            </span>
            <span className="dh-study__position">{position}</span>
          </div>
        </div>
        <div
          className="dh-study__progress"
          role="progressbar"
          aria-label="Session progress"
          aria-valuenow={Math.round(progress)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${progress}%` }} />
        </div>
        <div className="dh-study__tools">
          <div className="dh-seg" role="group" aria-label="Side panel">
            <PanelButton
              label={aiLabel}
              icon={revealed ? "ri-sparkling-2-line" : "ri-lightbulb-line"}
              shortcut={STUDY_ACTION_SHORTCUTS.explain}
              active={panelMode === "explain"}
              onClick={() => onPanelChange(panelMode === "explain" ? null : "explain")}
            />
            <PanelButton
              label="Edit"
              icon="ri-pencil-line"
              shortcut={STUDY_ACTION_SHORTCUTS.edit}
              active={panelMode === "edit"}
              onClick={() => onPanelChange(panelMode === "edit" ? null : "edit")}
            />
          </div>
          {more}
        </div>
      </div>
    </header>
  );
}

/** One side of the header's panel switch; its shortcut shows on hover. */
export function PanelButton({
  label,
  icon,
  shortcut,
  active,
  onClick,
}: {
  label: string;
  icon: string;
  shortcut: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dh-study__switch"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      aria-keyshortcuts={shortcut}
    >
      <i className={icon} aria-hidden />
      <span className="dh-study__switch-label">{label}</span>
      <span className="dh-study__tip" aria-hidden>
        {label}
        <kbd>{shortcut}</kbd>
      </span>
    </button>
  );
}

/** A More button and its menu. Escape closes the menu and leaves the side panel open. */
export function StudyPopMenu({
  label,
  disabled,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="dh-study__more" data-study-keys={open ? "ignore" : undefined}>
      <button
        type="button"
        className="dh-study__icon-btn"
        aria-label="More"
        aria-haspopup="menu"
        aria-expanded={open}
        title="More"
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-more-line" aria-hidden />
      </button>
      {open ? (
        <div className="dh-study__menu" role="menu" aria-label={label}>
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  );
}

/** Suspend, text size and audio autoplay, behind the header's More button. */
export function StudyMoreMenu({
  onSuspend,
  suspendDisabled,
  textScaleIndex,
  onTextScaleChange,
  audioAutoplay,
  onAudioAutoplayChange,
}: {
  onSuspend: () => void;
  suspendDisabled: boolean;
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
  audioAutoplay: boolean;
  onAudioAutoplayChange: (enabled: boolean) => void;
}) {
  return (
    <StudyPopMenu label="Session options">
      {(close) => (
        <>
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            disabled={suspendDisabled}
            onClick={() => {
              close();
              onSuspend();
            }}
          >
            <i className="ri-pause-circle-line" aria-hidden />
            Suspend card
            <kbd className="dh-menu-kbd">{STUDY_ACTION_SHORTCUTS.suspend}</kbd>
          </button>
          <div className="dh-menu-sep" />
          <div className="dh-study__menu-row">
            <span id="dh-study-text-size">Text size</span>
            <span className="dh-spacer" />
            <div className="dh-seg dh-seg--compact" role="group" aria-labelledby="dh-study-text-size">
              <button
                type="button"
                onClick={() => onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex - 1))}
                disabled={textScaleIndex <= 0}
                aria-label={`Decrease text size (${STUDY_ACTION_SHORTCUTS.zoomOut})`}
                title={`Smaller (${STUDY_ACTION_SHORTCUTS.zoomOut})`}
              >
                A−
              </button>
              <button
                type="button"
                onClick={() => onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex + 1))}
                disabled={textScaleIndex >= STUDY_TEXT_SCALE_STEPS.length - 1}
                aria-label={`Increase text size (${STUDY_ACTION_SHORTCUTS.zoomIn})`}
                title={`Larger (${STUDY_ACTION_SHORTCUTS.zoomIn})`}
              >
                A+
              </button>
            </div>
          </div>
          <div className="dh-study__menu-row">
            <span id="dh-study-audio">Auto-play audio</span>
            <span className="dh-spacer" />
            <button
              type="button"
              role="switch"
              className="dh-toggle"
              aria-checked={audioAutoplay}
              aria-labelledby="dh-study-audio"
              onClick={() => onAudioAutoplayChange(!audioAutoplay)}
            />
          </div>
        </>
      )}
    </StudyPopMenu>
  );
}

export type StudyFaceCard = {
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  cloze_ord: number | null;
};

function StudyQuestion({ card, revealed }: { card: StudyFaceCard; revealed: boolean }) {
  if (card.type === "image-occlusion") {
    const caption = parseCardContent(card.front ?? "")
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.value)
      .join("\n")
      .trim();
    return (
      <div className="dh-study__occlusion">
        {caption ? <CardContentRenderer content={caption} studyView /> : null}
        <OcclusionRenderer
          data={parseImageOcclusionData(card.occlusion_data)}
          activeOrd={card.cloze_ord}
          revealed={revealed}
          studyView
        />
      </div>
    );
  }
  if (card.type === "cloze" && card.cloze_text) {
    return (
      <CardContentRenderer
        content={card.cloze_text}
        clozeMode={revealed ? "revealed" : "hidden"}
        activeClozeOrd={card.cloze_ord}
        studyView
      />
    );
  }
  return <CardContentRenderer content={card.front} studyView />;
}

/** Card text straight on the canvas: the question, then a rule and the answer. */
export function StudyCardFace({
  card,
  cardKey,
  revealed,
  textScaleIndex,
}: {
  card: StudyFaceCard;
  cardKey: string;
  revealed: boolean;
  textScaleIndex: number;
}) {
  const reducedMotion = useReducedMotion();
  const transition = motionTransition(undefined, undefined, reducedMotion ?? false);
  const answer = card.type === "cloze" ? card.extra : card.back || card.extra;
  const answerIsExtra = card.type === "cloze" || !card.back;

  return (
    // popLayout: the next card slides in while the graded one fades out, so the
    // canvas is never empty between reviews.
    <AnimatePresence mode="popLayout">
      <m.div
        key={cardKey}
        className="dh-study__card"
        style={studySessionTextVars(STUDY_TEXT_SCALE_STEPS[textScaleIndex])}
        variants={studyCardSwap(reducedMotion ?? false)}
        initial="initial"
        animate="animate"
        exit="exit"
      >
        <div className="dh-study__question">
          <StudyQuestion card={card} revealed={revealed} />
        </div>
        <AnimatePresence>
          {revealed && answer ? (
            <m.div
              key="answer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={transition}
            >
              <div className="dh-study__rule" />
              <div className={answerIsExtra ? "dh-study__extra" : "dh-study__answer"}>
                <CardContentRenderer content={answer} studyView />
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>
      </m.div>
    </AnimatePresence>
  );
}

/** Show answer, then the four grades, in the one dock at the bottom. */
export function StudyDock({
  revealed,
  onReveal,
  onGrade,
  intervals,
  disabled = false,
}: {
  revealed: boolean;
  onReveal: () => void;
  onGrade: (grade: StudyGradeId) => void;
  intervals?: Partial<Record<StudyGradeId, string>> | null;
  disabled?: boolean;
}) {
  if (!revealed) {
    return (
      <button type="button" className="dh-study__show" onClick={onReveal}>
        Show answer
        <kbd className="dh-kbd">Space</kbd>
      </button>
    );
  }
  return (
    <div className="dh-study__grades">
      {STUDY_GRADES.map((grade) => {
        // Space/Enter grade Good. Say so in the tooltip rather than shading the button,
        // which reads as a suggested answer and nudges the grade.
        const hint = grade.id === "good" ? `${grade.hint}. Space or Enter` : grade.hint;
        return (
          <button
            key={grade.id}
            type="button"
            className="dh-study__grade"
            title={hint}
            aria-label={`${grade.label}. ${hint}`}
            onClick={() => onGrade(grade.id)}
            disabled={disabled}
          >
            <em aria-hidden>{grade.rating}</em>
            {grade.label}
            <small>{intervals?.[grade.id] ?? " "}</small>
            <u style={{ background: grade.color }} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/** After grading Again: a quiet way back to the card just missed, explained. */
/** A short, plain label for a card's answer, for the missed-card pill. */
export function missedAnswerLabel(card: StudyFaceCard): string {
  let text = "";
  if (card.type === "cloze" && card.cloze_text) {
    const answers = [...card.cloze_text.matchAll(/\{\{c(\d+)::([\s\S]+?)(?:::[\s\S]+?)?\}\}/g)]
      .filter((m) => !card.cloze_ord || Number(m[1]) === card.cloze_ord)
      .map((m) => m[2]);
    text = answers.join(", ");
  } else {
    text = card.back || card.extra || card.front || "";
  }
  const plain = text.replace(/<[^>]+>/g, " ").replace(/[*_`#]/g, "").replace(/\s+/g, " ").trim();
  return plain.length > 60 ? `${plain.slice(0, 57).trimEnd()}…` : plain || "this card";
}

export function StudyMissedPill({
  answer,
  onWhy,
  onDismiss,
}: {
  answer: string;
  onWhy: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="dh-study__missed" role="status">
      <span className="dh-study__missed-dot" aria-hidden />
      <span className="dh-study__missed-text">Missed: {answer}</span>
      <button type="button" className="dh-study__missed-why" onClick={onWhy}>
        <i className="ri-sparkling-2-line" aria-hidden />
        Why?
      </button>
      <button type="button" className="dh-study__missed-close" onClick={onDismiss} aria-label="Dismiss">
        <i className="ri-close-line" aria-hidden />
      </button>
    </div>
  );
}

export function StudyMeta({
  left,
  center,
  right,
  spread = false,
}: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  /** Lets a long left note take the room it needs, rather than a third of the row. */
  spread?: boolean;
}) {
  return (
    <div className={`dh-study__meta${spread ? " dh-study__meta--spread" : ""}`}>
      <div>{left}</div>
      <div className="dh-study__meta-center">{center}</div>
      <div className="dh-study__meta-right">{right}</div>
    </div>
  );
}

export function StudyError({ message }: { message: string | null }) {
  const reducedMotion = useReducedMotion();
  const transition = motionTransition(undefined, undefined, reducedMotion ?? false);
  return (
    <AnimatePresence>
      {message ? (
        <m.div
          key="study-error"
          className="dh-study__error"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={transition}
          role="alert"
        >
          {message}
        </m.div>
      ) : null}
    </AnimatePresence>
  );
}

export function StudySkeleton() {
  return (
    <div className="dh-study" aria-busy>
      <div className="dh-study__main">
        <div className="dh-study__top">
          <div className="dh-study__bar">
            <SkeletonBar width={180} height={12} />
            <div className="dh-study__progress" />
          </div>
        </div>
        <div className="dh-study__mid">
          <div className="dh-study__card dh-study__card--skeleton">
            <SkeletonBar width="72%" height={26} radius={8} />
            <SkeletonBar width="48%" height={26} radius={8} />
          </div>
        </div>
        <div className="dh-study__dock-wrap">
          <div className="dh-study__dock">
            <SkeletonBar width="100%" height={56} radius={13} />
          </div>
          <div className="dh-study__meta" />
        </div>
      </div>
    </div>
  );
}

/** A centred full-screen state: load failures, plan closed, budget reached. */
export function StudyMessage({
  icon,
  title,
  body,
  children,
}: {
  icon?: string;
  title?: string;
  body?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="dh-study">
      <FadeIn className="dh-study__done">
        {icon ? <i className={`${icon} dh-study__done-icon`} aria-hidden /> : null}
        {title ? <h1 className="dh-title">{title}</h1> : null}
        {body ? <p className="dh-study__done-sub">{body}</p> : null}
        <div className="dh-study__done-actions">{children}</div>
      </FadeIn>
    </div>
  );
}
