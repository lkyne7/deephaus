"use client";

import { useEffect, useRef, useState } from "react";
import { missNote, type CardFieldFix, type SittingMiss } from "@deephaus/shared";
import { STUDY_ACTION_SHORTCUTS } from "@/components/study-review-chrome";
import { StudyCardPanel, type StudyCardData } from "@/components/study-card-panel";
import { PanelButton, StudyCardFace, StudyFrame, type StudyPanelMode } from "@/components/study/study-chrome";
import {
  ignoresStudyShortcuts,
  useStudyPreferences,
} from "@/components/study/use-study-session-controls";
import type { SittingCard } from "@/lib/study/sitting";

/**
 * The cards missed today, question and answer together, with Explain and Edit
 * beside them. Nothing is graded or rescheduled.
 */
export function StudyLookOver({
  misses,
  onCardUpdated,
  onStop,
}: {
  misses: SittingMiss<SittingCard>[];
  onCardUpdated: (updated: StudyCardData) => void;
  onStop: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [panelMode, setPanelMode] = useState<StudyPanelMode | null>(null);
  const [editPrefill, setEditPrefill] = useState<CardFieldFix | null>(null);
  const { textScaleIndex } = useStudyPreferences();
  const openedAt = useRef(Date.now());
  const miss = misses[Math.min(index, misses.length - 1)];
  const last = index >= misses.length - 1;

  const move = (to: number) => {
    setPanelMode(null);
    setEditPrefill(null);
    setIndex(to);
  };
  const next = () => (last ? onStop() : move(index + 1));

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (ignoresStudyShortcuts(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      if (panelMode === "edit" || Date.now() - openedAt.current < 300) return;
      if (event.key === " " || event.key === "Enter") {
        if (event.target instanceof HTMLElement && event.target.closest("a, button")) return;
        event.preventDefault();
        next();
      } else if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        move(index - 1);
      } else if (event.key === "ArrowRight" && !last) {
        event.preventDefault();
        move(index + 1);
      } else if (event.key === "Escape" && !panelMode) {
        event.preventDefault();
        onStop();
      } else if (event.key.toLowerCase() === STUDY_ACTION_SHORTCUTS.explain.toLowerCase()) {
        event.preventDefault();
        setPanelMode(panelMode === "explain" ? null : "explain");
      } else if (event.key.toLowerCase() === STUDY_ACTION_SHORTCUTS.edit.toLowerCase()) {
        event.preventDefault();
        setPanelMode("edit");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!miss) return null;

  return (
    <StudyFrame
      header={
        <header className="dh-study__top">
          <div className="dh-study__bar">
            <div className="dh-study__where">
              <button
                type="button"
                className="dh-study__icon-btn"
                onClick={onStop}
                aria-label="Stop looking over"
                title="Stop looking over"
              >
                <i className="ri-close-line" aria-hidden />
              </button>
              <div className="dh-study__heading">
                <span className="dh-study__title">Looking over</span>
                <span className="dh-study__position">
                  {index + 1} of {misses.length}
                </span>
              </div>
            </div>
            <div
              className="dh-study__progress"
              role="progressbar"
              aria-label="Looked over"
              aria-valuenow={Math.round(((index + 1) / misses.length) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${((index + 1) / misses.length) * 100}%` }} />
            </div>
            <div className="dh-study__tools">
              <div className="dh-seg" role="group" aria-label="Side panel">
                <PanelButton
                  label="Explain"
                  icon="ri-sparkling-2-line"
                  shortcut={STUDY_ACTION_SHORTCUTS.explain}
                  active={panelMode === "explain"}
                  onClick={() => setPanelMode(panelMode === "explain" ? null : "explain")}
                />
                <PanelButton
                  label="Fix card"
                  icon="ri-pencil-line"
                  shortcut={STUDY_ACTION_SHORTCUTS.edit}
                  active={panelMode === "edit"}
                  onClick={() => setPanelMode(panelMode === "edit" ? null : "edit")}
                />
              </div>
            </div>
          </div>
        </header>
      }
      card={
        <>
          <StudyCardFace
            card={miss.card}
            cardKey={miss.key}
            revealed
            textScaleIndex={textScaleIndex}
          />
          <p className="dh-note dh-finish__miss">{missNote(miss, miss.card.lapses)}</p>
        </>
      }
      dock={
        <div className="dh-finish__dock">
          <button type="button" className="dh-finish__second" onClick={onStop}>
            Stop
            <kbd className="dh-kbd" aria-hidden>Esc</kbd>
          </button>
          <button type="button" className="dh-study__show" onClick={next}>
            {last ? "Finish" : "Next card"}
            <kbd className="dh-kbd" aria-hidden>Space</kbd>
          </button>
        </div>
      }
      meta={<p className="dh-finish__fine">Nothing is graded or rescheduled here.</p>}
      panel={
        panelMode ? (
          <StudyCardPanel
            key={`${panelMode}:${miss.key}`}
            mode={panelMode}
            card={miss.card}
            revealed
            deckId={miss.card.deck_id}
            editPrefill={editPrefill}
            onOpenEdit={(fix) => {
              setEditPrefill(fix);
              setPanelMode("edit");
            }}
            onClose={() => setPanelMode(null)}
            onSaved={onCardUpdated}
          />
        ) : null
      }
    />
  );
}
