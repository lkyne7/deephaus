"use client";

export type FsrsSettingsValues = {
  desiredRetention: number;
  newCardsPerDay: number;
};

type Props = {
  values: FsrsSettingsValues;
  onChange: (patch: Partial<FsrsSettingsValues>) => void;
  disabled?: boolean;
  /** When set, fields are read-only and show inherited global values. */
  inheritedFromGlobal?: boolean;
  idPrefix?: string;
};

export function FsrsSettingsFields({
  values,
  onChange,
  disabled = false,
  inheritedFromGlobal = false,
  idPrefix = "fsrs",
}: Props) {
  const readOnly = disabled || inheritedFromGlobal;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
      <div>
        <label
          htmlFor={`${idPrefix}-retention`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: "500 13px/20px var(--font-sans)",
            color: "var(--ink-700)",
            marginBottom: 6,
          }}
        >
          <span>Desired retention</span>
          <strong style={{ color: "var(--ink-900)" }}>
            {Math.round(values.desiredRetention * 100)}%
          </strong>
        </label>
        <input
          id={`${idPrefix}-retention`}
          type="range"
          min={70}
          max={97}
          step={1}
          value={Math.round(values.desiredRetention * 100)}
          onChange={(e) =>
            onChange({ desiredRetention: Number(e.target.value) / 100 })
          }
          disabled={readOnly}
          style={{ width: "100%", accentColor: "var(--teal-500)" }}
        />
        <p style={{ font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)", marginTop: 6 }}>
          {inheritedFromGlobal
            ? "Using your global profile default. Turn off “Use global defaults” on this deck to customize."
            : "Higher retention schedules more frequent reviews. 90% matches the Anki default."}
        </p>
      </div>
      <div>
        <label
          htmlFor={`${idPrefix}-new-cards`}
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: "500 13px/20px var(--font-sans)",
            color: "var(--ink-700)",
            marginBottom: 6,
          }}
        >
          <span>New cards per day</span>
          <strong style={{ color: "var(--ink-900)" }}>{values.newCardsPerDay}</strong>
        </label>
        <input
          id={`${idPrefix}-new-cards`}
          type="number"
          min={0}
          max={200}
          step={1}
          value={values.newCardsPerDay}
          onChange={(e) =>
            onChange({
              newCardsPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
            })
          }
          disabled={readOnly}
          className="input"
          style={{ width: "100%" }}
        />
        <p style={{ font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)", marginTop: 6 }}>
          {inheritedFromGlobal
            ? "Using your global profile default for how many unseen cards are introduced each day."
            : "How many never-seen cards DeepHaus introduces from this deck each day."}
        </p>
      </div>
    </div>
  );
}
