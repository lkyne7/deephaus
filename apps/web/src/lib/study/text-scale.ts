import type { CSSProperties } from "react";

export const STUDY_TEXT_SCALE_STEPS = [18, 20, 22, 24, 26, 28, 32, 36] as const;
export const DEFAULT_STUDY_TEXT_SCALE_INDEX = 3;
export const STUDY_TEXT_SCALE_STORAGE_KEY = "deephaus.studyTextScale";

export function clampStudyTextScaleIndex(index: number): number {
  return Math.max(0, Math.min(STUDY_TEXT_SCALE_STEPS.length - 1, index));
}

export function readStoredStudyTextScaleIndex(): number {
  if (typeof window === "undefined") return DEFAULT_STUDY_TEXT_SCALE_INDEX;
  try {
    const raw = window.localStorage.getItem(STUDY_TEXT_SCALE_STORAGE_KEY);
    if (raw == null) return DEFAULT_STUDY_TEXT_SCALE_INDEX;
    const parsed = Number.parseInt(raw, 10);
    if (!Number.isFinite(parsed)) return DEFAULT_STUDY_TEXT_SCALE_INDEX;
    return clampStudyTextScaleIndex(parsed);
  } catch {
    return DEFAULT_STUDY_TEXT_SCALE_INDEX;
  }
}

export function writeStoredStudyTextScaleIndex(index: number): void {
  try {
    window.localStorage.setItem(STUDY_TEXT_SCALE_STORAGE_KEY, String(index));
  } catch {
    // Ignore quota / private mode errors.
  }
}

export function studyCardTextStyle(fontSizePx: number): CSSProperties {
  return {
    fontSize: fontSizePx,
    lineHeight: `${Math.round(fontSizePx * 1.5)}px`,
    fontWeight: 500,
    color: "var(--ink-700)",
    maxWidth: 720,
    width: "100%",
  };
}
