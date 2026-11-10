"use client";

import { useId } from "react";
import {
  curveChoiceLabel,
  dailyCapLabel,
  percentLabel,
  recallPercent,
  shortestOnTarget,
  type CurveChoice,
} from "./exam-helpers";
import "./exams.css";

/** Where the dot scale starts: a round number a little under the lowest score. */
function scaleFloor(choices: readonly CurveChoice[], target: number): number {
  const lowest = Math.min(target, ...choices.map((choice) => choice.recall));
  return Math.max(0, Math.min(0.6, Math.floor(lowest * 10 - 1) / 10));
}

/**
 * The time-versus-score curve as a list you can choose from: one row per
 * daily budget, a dot for the score it reaches and a line for the target.
 */
export function ExamCurve({
  choices,
  target,
  onSelect,
  disabled = false,
  dimmed = false,
}: {
  choices: CurveChoice[];
  target: number;
  onSelect: (minutes: number | null) => void;
  disabled?: boolean;
  dimmed?: boolean;
}) {
  const name = useId();
  const floor = scaleFloor(choices, target);
  const position = (recall: number) =>
    `${(Math.min(1, Math.max(floor, recall)) - floor) * (100 / (1 - floor))}%`;
  const shortest = shortestOnTarget(choices);
  const targetText = percentLabel(target);

  return (
    <div className={`exam-curve${dimmed ? " is-updating" : ""}`}>
      <div role="radiogroup" aria-label="Daily time and the score it reaches">
        {choices.map((choice) => (
          <label
            key={choice.minutes ?? "none"}
            className={`exam-curve__row${choice.selected ? " is-selected" : ""}`}
          >
            <input
              type="radio"
              name={name}
              checked={choice.selected}
              disabled={disabled}
              onChange={() => onSelect(choice.minutes)}
              aria-label={curveChoiceLabel(choice)}
            />
            <span className="exam-curve__time">
              {dailyCapLabel(choice.minutes)}
              {choice === shortest && choice.minutes !== null ? (
                <span className="exam-curve__hint">Shortest that reaches {targetText}</span>
              ) : null}
            </span>
            <span className="exam-curve__track" aria-hidden>
              <span className="exam-curve__target" style={{ left: position(target) }} />
              <span
                className={`exam-curve__dot${choice.meetsTarget ? " is-on-target" : ""}`}
                style={{ left: position(choice.recall) }}
              />
            </span>
            <span className="exam-curve__score">{recallPercent(choice.recall)}%</span>
          </label>
        ))}
      </div>
      <p className="exam-field-hint">
        The score each daily time is on track for. The line marks your {targetText} target.
      </p>
    </div>
  );
}
