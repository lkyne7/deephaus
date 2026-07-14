"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  FsrsSettingsFields,
  type FsrsSettingsValues,
} from "@/components/fsrs-settings-fields";

export type GlobalFsrsSettingsValues = FsrsSettingsValues & {
  /** Hour (0-23) the study day rolls over, like Anki's "next day starts at". */
  dayStartHour: number;
};

type Props = {
  initialSettings: GlobalFsrsSettingsValues;
};

function formatRolloverHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

export function GlobalFsrsSettingsPanel({ initialSettings }: Props) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [savedSettings, setSavedSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty =
    settings.desiredRetention !== savedSettings.desiredRetention ||
    settings.newCardsPerDay !== savedSettings.newCardsPerDay ||
    settings.dayStartHour !== savedSettings.dayStartHour;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/fsrs/settings", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...settings,
          // Capture the browser timezone so the rollover hour is applied in
          // the user's local time when the server computes "today".
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to save settings");
      setSavedSettings(settings);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section style={s.card}>
      <div style={s.sectionHead}>
        <div>
          <h2 style={s.sectionTitle}>Global FSRS defaults</h2>
          <p style={s.sectionSub}>
            These defaults apply to new decks and any deck that uses global FSRS settings. Per-deck
            overrides are available on each deck&apos;s settings page.
          </p>
        </div>
        {dirty ? (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setSettings(savedSettings)}
              disabled={saving}
            >
              Reset
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        ) : null}
      </div>

      <FsrsSettingsFields
        idPrefix="profile-global"
        values={settings}
        onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
      />

      <div style={{ maxWidth: "calc(50% - 12px)" }}>
        <label
          htmlFor="profile-global-day-start"
          style={{
            display: "flex",
            justifyContent: "space-between",
            font: "500 13px/20px var(--font-sans)",
            color: "var(--ink-700)",
            marginBottom: 6,
          }}
        >
          <span>Next day starts at</span>
          <strong style={{ color: "var(--ink-900)" }}>
            {formatRolloverHour(settings.dayStartHour)}
          </strong>
        </label>
        <select
          id="profile-global-day-start"
          className="input"
          style={{ width: "100%" }}
          value={settings.dayStartHour}
          disabled={saving}
          onChange={(e) =>
            setSettings((current) => ({ ...current, dayStartHour: Number(e.target.value) }))
          }
        >
          {Array.from({ length: 24 }, (_, hour) => (
            <option key={hour} value={hour}>
              {hour === 0
                ? "Midnight"
                : `${formatRolloverHour(hour)} (${hour} hour${hour === 1 ? "" : "s"} past midnight)`}
            </option>
          ))}
        </select>
        <p style={{ font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)", marginTop: 6 }}>
          Reviews done before this hour count toward the previous day, and daily new-card limits
          reset at this time. Anki&apos;s default is 4:00 AM.
        </p>
      </div>

      {error ? (
        <p style={{ font: "500 13px/18px var(--font-sans)", color: "var(--grade-again)", margin: "8px 0 0" }}>
          {error}
        </p>
      ) : null}
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: "var(--bg-surface)",
    border: "1px solid var(--border-secondary)",
    borderRadius: 8,
    padding: 24,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  sectionHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  sectionTitle: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--fg-primary)",
    margin: 0,
  },
  sectionSub: {
    font: "400 14px/22px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    maxWidth: 560,
  },
};
