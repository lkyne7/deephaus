"use client";

import { StudyTextSizeControls } from "@/components/study-text-size-controls";

type Props = {
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
  onEdit: () => void;
  onExplain: () => void;
  onSuspend: () => void;
  suspendDisabled?: boolean;
};

/** Persistent study/cram session actions (text size, suspend, edit, explain). */
export function StudySessionToolbar({
  textScaleIndex,
  onTextScaleChange,
  onEdit,
  onExplain,
  onSuspend,
  suspendDisabled = false,
}: Props) {
  return (
    <div className="study-session-toolbar" role="toolbar" aria-label="Study actions">
      <StudyTextSizeControls scaleIndex={textScaleIndex} onChange={onTextScaleChange} />
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
    </div>
  );
}
