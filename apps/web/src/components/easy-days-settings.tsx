"use client";

import "./easy-days-settings.css";
import { useId } from "react";
import {
  EASY_DAY_NAMES,
  EASY_DAY_LEVELS,
  normalEasyDays,
  weekendWarriorDays,
  type EasyDayLevel,
  type EasyDays,
} from "@deephaus/shared";

const LEVEL_LABEL: Record<EasyDayLevel, string> = {
  normal: "Normal",
  reduced: "Reduced",
  minimum: "Minimum",
};

/** Clicking a day steps it lighter, then wraps back to Normal. */
function nextLevel(level: EasyDayLevel): EasyDayLevel {
  const index = EASY_DAY_LEVELS.indexOf(level);
  return EASY_DAY_LEVELS[(index + EASY_DAY_LEVELS.length - 1) % EASY_DAY_LEVELS.length];
}

export function EasyDaysSettings({
  value,
  onChange,
  disabled = false,
}: {
  value: EasyDays;
  onChange: (days: EasyDays) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const weekend = JSON.stringify(value) === JSON.stringify(weekendWarriorDays());
  const normal = value.every((day) => day === "normal");

  return (
    <section className="dhs-sec">
      <div className="dhs-sec-head">
        <h2 id={`${id}-title`}>Easy Days</h2>
        <div className="dh-seg" role="group" aria-label="Easy Days presets">
          <button
            type="button"
            aria-pressed={normal}
            disabled={disabled}
            onClick={() => onChange(normalEasyDays())}
          >
            Normal week
          </button>
          <button
            type="button"
            aria-pressed={weekend}
            disabled={disabled}
            title="Lighter Saturdays and Sundays"
            onClick={() => onChange(weekendWarriorDays())}
          >
            Weekend warrior
          </button>
        </div>
      </div>
      <div className="dh-easy-days-wrap">
        <div className="dh-easy-days" role="group" aria-labelledby={`${id}-title`} aria-describedby={`${id}-help`}>
          {EASY_DAY_NAMES.map((day, index) => (
            <button
              key={day}
              type="button"
              className="dh-easy-day"
              data-level={value[index]}
              disabled={disabled}
              aria-label={`${day} review load: ${LEVEL_LABEL[value[index]]}. Change to ${LEVEL_LABEL[nextLevel(value[index])]}.`}
              onClick={() =>
                onChange(value.map((level, i) => (i === index ? nextLevel(level) : level)))
              }
            >
              <b>{day.slice(0, 3)}</b>
              <span>{LEVEL_LABEL[value[index]]}</span>
            </button>
          ))}
        </div>
      </div>
      <p id={`${id}-help`} className="dhs-help">
        Reviews shift away from lighter days, across all decks. At least one day stays Normal. Click
        a day to change it. Existing due cards and learning steps stay as they are, and no setting
        guarantees a day off.
      </p>
      {!value.includes("normal") ? (
        <p role="alert" className="dhs-error">
          Keep at least one day set to Normal so reviews have somewhere to move.
        </p>
      ) : null}
    </section>
  );
}
