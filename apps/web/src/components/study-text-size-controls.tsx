"use client";

import {
  clampStudyTextScaleIndex,
  STUDY_TEXT_SCALE_STEPS,
} from "@/lib/study/text-scale";

type Props = {
  scaleIndex: number;
  onChange: (index: number) => void;
};

export function StudyTextSizeControls({ scaleIndex, onChange }: Props) {
  const atMin = scaleIndex <= 0;
  const atMax = scaleIndex >= STUDY_TEXT_SCALE_STEPS.length - 1;

  return (
    <div style={s.root} role="group" aria-label="Card text size">
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange(clampStudyTextScaleIndex(scaleIndex - 1))}
        disabled={atMin}
        title="Smaller text"
        aria-label="Decrease text size"
      >
        A−
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange(clampStudyTextScaleIndex(scaleIndex + 1))}
        disabled={atMax}
        title="Larger text"
        aria-label="Increase text size"
      >
        A+
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "inline-flex",
    alignItems: "center",
    gap: 2,
  },
};
