"use client";

import { useCallback, useEffect, useState } from "react";
import { STUDY_ACTION_SHORTCUTS, STUDY_GRADES, type StudyGradeId } from "@/components/study-review-chrome";
import type { StudyPanelMode } from "@/components/study/study-chrome";
import {
  readStoredStudyAudioAutoplay,
  writeStoredStudyAudioAutoplay,
} from "@/lib/study/audio-autoplay";
import {
  clampStudyTextScaleIndex,
  DEFAULT_STUDY_TEXT_SCALE_INDEX,
  readStoredStudyTextScaleIndex,
  writeStoredStudyTextScaleIndex,
} from "@/lib/study/text-scale";

/** Text size and audio autoplay, remembered across sessions. */
export function useStudyPreferences() {
  const [textScaleIndex, setTextScaleIndex] = useState(DEFAULT_STUDY_TEXT_SCALE_INDEX);
  const [audioAutoplay, setAudioAutoplayState] = useState(true);

  useEffect(() => {
    setTextScaleIndex(readStoredStudyTextScaleIndex());
    setAudioAutoplayState(readStoredStudyAudioAutoplay());
  }, []);

  const setTextScale = useCallback((index: number) => {
    setTextScaleIndex(index);
    writeStoredStudyTextScaleIndex(index);
  }, []);

  const setAudioAutoplay = useCallback((enabled: boolean) => {
    setAudioAutoplayState(enabled);
    writeStoredStudyAudioAutoplay(enabled);
  }, []);

  return { textScaleIndex, setTextScale, audioAutoplay, setAudioAutoplay };
}

/** The open side panel; it closes whenever the card changes. */
export function useStudyPanel(cardKey: string) {
  const [panelMode, setPanelMode] = useState<StudyPanelMode | null>(null);
  useEffect(() => {
    setPanelMode(null);
  }, [cardKey]);
  return [panelMode, setPanelMode] as const;
}

function ignoresShortcuts(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    target.isContentEditable ||
    target.closest('[data-study-keys="ignore"]') !== null
  );
}

/**
 * Session keyboard: Space/Enter reveal then Good, 1-4, E, X, @, [ and ].
 * Undo and redo are bound only when the session supports them. Grading keeps
 * working beside the Explain panel; the edit panel owns the keyboard.
 */
export function useStudyShortcuts({
  panelMode,
  setPanelMode,
  revealed,
  onReveal,
  onGrade,
  gradingBlocked = false,
  onUndo,
  onRedo,
  onSuspend,
  textScaleIndex,
  onTextScaleChange,
}: {
  panelMode: StudyPanelMode | null;
  setPanelMode: (mode: StudyPanelMode | null) => void;
  revealed: boolean;
  onReveal: () => void;
  onGrade: (grade: StudyGradeId) => void;
  gradingBlocked?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  onSuspend: () => void;
  textScaleIndex: number;
  onTextScaleChange: (index: number) => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (ignoresShortcuts(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (panelMode === "edit") return;
      const key = event.key;

      if (onUndo && key === STUDY_ACTION_SHORTCUTS.undo) {
        event.preventDefault();
        onUndo();
        return;
      }
      if (onRedo && key === STUDY_ACTION_SHORTCUTS.redo) {
        event.preventDefault();
        onRedo();
        return;
      }
      if (key === " " || key === "Enter") {
        event.preventDefault();
        if (!revealed) onReveal();
        else if (!gradingBlocked) onGrade("good");
        return;
      }
      if (revealed && !gradingBlocked && ["1", "2", "3", "4"].includes(key)) {
        onGrade(STUDY_GRADES[Number(key) - 1].id);
        return;
      }
      if (key.toLowerCase() === STUDY_ACTION_SHORTCUTS.edit.toLowerCase()) {
        event.preventDefault();
        setPanelMode("edit");
        return;
      }
      if (key.toLowerCase() === STUDY_ACTION_SHORTCUTS.explain.toLowerCase()) {
        event.preventDefault();
        setPanelMode(panelMode === "explain" ? null : "explain");
        return;
      }
      if (key === STUDY_ACTION_SHORTCUTS.suspend) {
        event.preventDefault();
        onSuspend();
        return;
      }
      if (key === STUDY_ACTION_SHORTCUTS.zoomOut) {
        event.preventDefault();
        onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex - 1));
        return;
      }
      if (key === STUDY_ACTION_SHORTCUTS.zoomIn) {
        event.preventDefault();
        onTextScaleChange(clampStudyTextScaleIndex(textScaleIndex + 1));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    gradingBlocked,
    onGrade,
    onRedo,
    onReveal,
    onSuspend,
    onTextScaleChange,
    onUndo,
    panelMode,
    revealed,
    setPanelMode,
    textScaleIndex,
  ]);
}
