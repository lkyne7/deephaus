"use client";

import {
  clampStudyTextScaleIndex,
  STUDY_TEXT_SCALE_STEPS,
} from "@/lib/study/text-scale";

type Props = {
  scaleIndex: number;
  onChange: (index: number) => void;
  /** `icon` renders square zoom-out / zoom-in buttons. */
  variant?: "text" | "icon";
  zoomOutShortcut?: string;
  zoomInShortcut?: string;
};

function ZoomHoverLabel({ label, shortcut }: { label: string; shortcut?: string }) {
  return (
    <span className="study-session-hover-label" role="tooltip" aria-hidden>
      <span className="study-session-hover-label-text">{label}</span>
      {shortcut ? <span className="study-session-hover-shortcut">{shortcut}</span> : null}
    </span>
  );
}

export function StudyTextSizeControls({
  scaleIndex,
  onChange,
  variant = "text",
  zoomOutShortcut,
  zoomInShortcut,
}: Props) {
  const atMin = scaleIndex <= 0;
  const atMax = scaleIndex >= STUDY_TEXT_SCALE_STEPS.length - 1;
  const icon = variant === "icon";

  const zoomOutBtn = (
    <button
      type="button"
      className={icon ? "btn btn-secondary study-session-icon-btn" : "btn btn-secondary btn-sm"}
      onClick={() => onChange(clampStudyTextScaleIndex(scaleIndex - 1))}
      disabled={atMin}
      title={icon ? undefined : "Smaller text"}
      aria-label={
        zoomOutShortcut ? `Decrease text size (${zoomOutShortcut})` : "Decrease text size"
      }
    >
      {icon ? (
        <>
          <ZoomHoverLabel label="Zoom out" shortcut={zoomOutShortcut} />
          <i className="ri-zoom-out-line" aria-hidden />
        </>
      ) : (
        "A−"
      )}
    </button>
  );

  const zoomInBtn = (
    <button
      type="button"
      className={icon ? "btn btn-secondary study-session-icon-btn" : "btn btn-secondary btn-sm"}
      onClick={() => onChange(clampStudyTextScaleIndex(scaleIndex + 1))}
      disabled={atMax}
      title={icon ? undefined : "Larger text"}
      aria-label={
        zoomInShortcut ? `Increase text size (${zoomInShortcut})` : "Increase text size"
      }
    >
      {icon ? (
        <>
          <ZoomHoverLabel label="Zoom in" shortcut={zoomInShortcut} />
          <i className="ri-zoom-in-line" aria-hidden />
        </>
      ) : (
        "A+"
      )}
    </button>
  );

  return (
    <div
      className={
        icon
          ? "study-text-size-controls study-text-size-controls--icon"
          : "study-text-size-controls"
      }
      role="group"
      aria-label="Card text size"
    >
      {icon ? (
        <>
          {zoomInBtn}
          {zoomOutBtn}
        </>
      ) : (
        <>
          {zoomOutBtn}
          {zoomInBtn}
        </>
      )}
    </div>
  );
}
