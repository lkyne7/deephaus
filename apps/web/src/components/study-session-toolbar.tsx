"use client";

import { StudyTextSizeControls } from "@/components/study-text-size-controls";

export const STUDY_ACTION_SHORTCUTS = {
  explain: "X",
  edit: "E",
  suspend: "@",
  zoomOut: "[",
  zoomIn: "]",
  undo: "ArrowLeft",
  redo: "ArrowRight",
} as const;

/** Display glyph for keyboard shortcut hints / hover labels. */
export function studyShortcutLabel(shortcut: string): string {
  if (shortcut === "ArrowLeft") return "←";
  if (shortcut === "ArrowRight") return "→";
  if (shortcut === "ArrowUp") return "↑";
  if (shortcut === "ArrowDown") return "↓";
  return shortcut;
}

type Props = {
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
  /** Whether a card's audio clips play on show/reveal; omitted hides the control. */
  audioAutoplay?: boolean;
  onAudioAutoplayChange?: (enabled: boolean) => void;
  onEdit: () => void;
  onExplain: () => void;
  onSuspend: () => void;
  suspendDisabled?: boolean;
  /** `side` stacks icon-only actions beside the card. */
  placement?: "top" | "side";
};

function StudyActionHoverLabel({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <span className="study-session-hover-label" role="tooltip" aria-hidden>
      <span className="study-session-hover-label-text">{label}</span>
      {shortcut ? <span className="study-session-hover-shortcut">{shortcut}</span> : null}
    </span>
  );
}

/** Persistent study/cram session actions (text size, suspend, edit, explain). */
export function StudySessionToolbar({
  textScaleIndex,
  onTextScaleChange,
  audioAutoplay,
  onAudioAutoplayChange,
  onEdit,
  onExplain,
  onSuspend,
  suspendDisabled = false,
  placement = "top",
}: Props) {
  const side = placement === "side";

  return (
    <div
      className={side ? "study-session-toolbar study-session-toolbar--side" : "study-session-toolbar"}
      role="toolbar"
      aria-label="Study actions"
    >
      {side ? (
        <>
          <button
            type="button"
            className="btn btn-primary study-session-icon-btn"
            onClick={onExplain}
            aria-label={`Explain (${STUDY_ACTION_SHORTCUTS.explain})`}
          >
            <StudyActionHoverLabel label="Explain" shortcut={STUDY_ACTION_SHORTCUTS.explain} />
            <i className="ri-sparkling-2-line" aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn-secondary study-session-icon-btn"
            onClick={onEdit}
            aria-label={`Edit (${STUDY_ACTION_SHORTCUTS.edit})`}
          >
            <StudyActionHoverLabel label="Edit" shortcut={STUDY_ACTION_SHORTCUTS.edit} />
            <i className="ri-pencil-line" aria-hidden />
          </button>
          <button
            type="button"
            className="btn btn-secondary study-session-icon-btn"
            onClick={onSuspend}
            disabled={suspendDisabled}
            aria-label={`Suspend (${STUDY_ACTION_SHORTCUTS.suspend})`}
          >
            <StudyActionHoverLabel label="Suspend" shortcut={STUDY_ACTION_SHORTCUTS.suspend} />
            <i className="ri-pause-circle-line" aria-hidden />
          </button>
          <StudyTextSizeControls
            scaleIndex={textScaleIndex}
            onChange={onTextScaleChange}
            variant="icon"
            zoomOutShortcut={STUDY_ACTION_SHORTCUTS.zoomOut}
            zoomInShortcut={STUDY_ACTION_SHORTCUTS.zoomIn}
          />
          {onAudioAutoplayChange ? (
            <button
              type="button"
              className="btn btn-secondary study-session-icon-btn"
              onClick={() => onAudioAutoplayChange(!audioAutoplay)}
              aria-pressed={audioAutoplay}
              aria-label={audioAutoplay ? "Auto-play audio: on" : "Auto-play audio: off"}
            >
              <StudyActionHoverLabel label={audioAutoplay ? "Auto-play audio on" : "Auto-play audio off"} />
              <i className={audioAutoplay ? "ri-volume-up-line" : "ri-volume-mute-line"} aria-hidden />
            </button>
          ) : null}
        </>
      ) : (
        <>
          <StudyTextSizeControls scaleIndex={textScaleIndex} onChange={onTextScaleChange} />
          {onAudioAutoplayChange ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => onAudioAutoplayChange(!audioAutoplay)}
              aria-pressed={audioAutoplay}
              title={audioAutoplay ? "Audio auto-plays on show and reveal" : "Audio plays only when you press play"}
            >
              <i className={audioAutoplay ? "ri-volume-up-line" : "ri-volume-mute-line"} aria-hidden />
              {audioAutoplay ? "Audio on" : "Audio off"}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={onSuspend}
            disabled={suspendDisabled}
            title="Suspend this card"
          >
            <i className="ri-pause-circle-line" aria-hidden />
            Suspend
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit}>
            <i className="ri-pencil-line" aria-hidden />
            Edit
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={onExplain}>
            <i className="ri-sparkling-2-line" aria-hidden />
            Explain
          </button>
        </>
      )}
    </div>
  );
}
