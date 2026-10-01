"use client";

import { useId } from "react";
import {
  EASY_DAY_NAMES,
  EASY_DAY_LEVELS,
  EASY_DAYS_DESCRIPTION,
  normalEasyDays,
  weekendWarriorDays,
  type EasyDays,
} from "@deephaus/shared";

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
  const weekend =
    JSON.stringify(value) === JSON.stringify(weekendWarriorDays());
  const normal = value.every((day) => day === "normal");
  return (
    <fieldset
      disabled={disabled}
      style={{
        border: "1px solid var(--border-primary)",
        borderRadius: 14,
        padding: 20,
        margin: "12px 0 0",
        minWidth: 0,
      }}
    >
      <legend
        style={{
          padding: "0 6px",
          font: "600 15px var(--font-sans)",
          color: "var(--fg-primary)",
        }}
      >
        Easy Days
      </legend>
      <p
        id={`${id}-help`}
        style={{
          font: "400 13px/20px var(--font-sans)",
          color: "var(--fg-3)",
          margin: "0 0 14px",
        }}
      >
        {EASY_DAYS_DESCRIPTION}
      </p>
      <div
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 18 }}
      >
        <button
          type="button"
          className={`btn btn-sm ${normal ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={normal}
          onClick={() => onChange(normalEasyDays())}
        >
          Normal week
        </button>
        <button
          type="button"
          className={`btn btn-sm ${weekend ? "btn-primary" : "btn-secondary"}`}
          aria-pressed={weekend}
          onClick={() => onChange(weekendWarriorDays())}
        >
          Weekend warrior
        </button>
        <span
          style={{
            alignSelf: "center",
            font: "400 12px var(--font-sans)",
            color: "var(--fg-4)",
          }}
        >
          Lighter Saturdays &amp; Sundays
        </span>
      </div>
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginLeft: 46,
          marginBottom: 4,
          font: "500 11px var(--font-sans)",
          color: "var(--fg-3)",
        }}
      >
        <span>Minimum</span>
        <span>Reduced</span>
        <span>Normal</span>
      </div>
      {EASY_DAY_NAMES.map((day, index) => (
        <div
          key={day}
          style={{
            display: "grid",
            gridTemplateColumns: "36px minmax(0, 1fr)",
            alignItems: "center",
            gap: 10,
            minHeight: 43,
            borderTop: "1px solid var(--border-primary)",
          }}
        >
          <label
            htmlFor={`${id}-${index}`}
            style={{
              font: "500 12px var(--font-sans)",
              color: "var(--fg-primary)",
            }}
          >
            {day.slice(0, 3)}
          </label>
          <input
            id={`${id}-${index}`}
            type="range"
            min={0}
            max={2}
            step={1}
            value={EASY_DAY_LEVELS.indexOf(value[index])}
            aria-label={`${day} review load`}
            aria-valuetext={value[index]}
            aria-describedby={`${id}-help`}
            onChange={(event) =>
              onChange(
                value.map((level, i) =>
                  i === index
                    ? EASY_DAY_LEVELS[Number(event.target.value)]
                    : level,
                ),
              )
            }
            style={{
              width: "100%",
              minWidth: 0,
              accentColor: "var(--brand-500)",
              cursor: "pointer",
            }}
          />
        </div>
      ))}
      {!value.includes("normal") && (
        <p
          role="alert"
          style={{ color: "var(--danger, #b42318)", fontSize: 12 }}
        >
          Keep at least one day set to Normal so reviews have somewhere to move.
        </p>
      )}
      <p
        style={{
          margin: "12px 0 0",
          color: "var(--fg-4)",
          font: "400 12px/18px var(--font-sans)",
        }}
      >
        Minimum strongly favors nearby normal days. Reduced moves fewer reviews.
        Neither guarantees a day off.
      </p>
    </fieldset>
  );
}
