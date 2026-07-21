"use client";

import { m } from "motion/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FsrsSettingsFields } from "@/components/fsrs-settings-fields";
import {
  SettingsLoadingState,
  type SettingsStudyData,
} from "@/components/settings/settings-overlay";

function formatRolloverHour(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type SettingsValues = {
  desiredRetention: number;
  newCardsPerDay: number;
  dayStartHour: number;
};

type Props = {
  study: SettingsStudyData | null;
  onStudyUpdated: (patch: Partial<SettingsStudyData>) => void;
};

export function StudySection({ study, onStudyUpdated }: Props) {
  const router = useRouter();

  const [settings, setSettings] = useState<SettingsValues | null>(null);
  const [savedSettings, setSavedSettings] = useState<SettingsValues | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  // Study data arrives async after the overlay opens; seed the form once.
  useEffect(() => {
    if (!study || settings) return;
    const initial = {
      desiredRetention: study.desiredRetention,
      newCardsPerDay: study.newCardsPerDay,
      dayStartHour: study.dayStartHour,
    };
    setSettings(initial);
    setSavedSettings(initial);
  }, [study, settings]);

  if (!study || !settings || !savedSettings) {
    return <SettingsLoadingState label="Loading study settings…" />;
  }

  const dirty =
    settings.desiredRetention !== savedSettings.desiredRetention ||
    settings.newCardsPerDay !== savedSettings.newCardsPerDay ||
    settings.dayStartHour !== savedSettings.dayStartHour;

  const optimizerReady = study.usableItems >= study.optimizerMinLogs;
  const optimizerProgress = Math.min(study.usableItems / study.optimizerMinLogs, 1);
  const usableRemaining = Math.max(0, study.optimizerMinLogs - study.usableItems);

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
      onStudyUpdated(settings!);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function handleOptimize() {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const res = await fetch("/api/fsrs/optimize", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to optimize");
      onStudyUpdated({ lastOptimizedAt: new Date().toISOString() });
      router.refresh();
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : "Failed to optimize");
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <div style={s.root}>
      {/* Global FSRS defaults */}
      <section style={s.block}>
        <div style={s.blockHead}>
          <div>
            <div style={s.blockTitle}>Global FSRS defaults</div>
            <p style={s.blockSub}>
              These defaults apply to new decks and any deck that uses global FSRS settings.
              Per-deck overrides are available on each deck&apos;s settings page.
            </p>
          </div>
          {dirty ? (
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSettings(savedSettings)}
                disabled={saving}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void save()}
                disabled={saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          ) : null}
        </div>

        <FsrsSettingsFields
          idPrefix="settings-global"
          values={settings}
          onChange={(patch) => setSettings((current) => ({ ...current!, ...patch }))}
        />

        <div style={{ maxWidth: 360 }}>
          <label
            htmlFor="settings-global-day-start"
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
            id="settings-global-day-start"
            className="input"
            style={{ width: "100%" }}
            value={settings.dayStartHour}
            disabled={saving}
            onChange={(e) =>
              setSettings((current) => ({ ...current!, dayStartHour: Number(e.target.value) }))
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

        {error ? <p style={s.error}>{error}</p> : null}
      </section>

      {/* Adaptive learning */}
      <section style={{ ...s.block, borderBottom: "none", paddingBottom: 0 }}>
        <div style={s.blockHead}>
          <div>
            <div style={s.blockTitle}>Adaptive learning</div>
            <p style={s.blockSub}>
              DeepHaus uses the FSRS-5 algorithm to decide when to show each card. Once
              you&apos;ve reviewed enough cards across multiple days, you can fit personal
              scheduler parameters to your own memory.
            </p>
          </div>
        </div>

        <div style={s.fsrsRow}>
          <div style={s.fsrsMeter}>
            <div style={s.fsrsMeterTrack}>
              <m.div
                style={{
                  height: "100%",
                  background: optimizerReady ? "var(--brand-500)" : "var(--gray-400)",
                }}
                initial={{ width: 0 }}
                animate={{ width: `${optimizerProgress * 100}%` }}
                transition={{ duration: 0.32, ease: [0.4, 0, 0.2, 1] }}
              />
            </div>
            <div style={s.fsrsMeterLabels}>
              <span>
                <strong style={{ color: "var(--fg-primary)" }}>
                  {study.usableItems.toLocaleString()}
                </strong>{" "}
                / {study.optimizerMinLogs.toLocaleString()} trainable reviews
              </span>
              <span>
                {optimizerReady
                  ? "Ready to optimize"
                  : `${usableRemaining.toLocaleString()} more to unlock`}
              </span>
            </div>
            <p style={s.fsrsHint}>
              {optimizerReady ? (
                <>
                  You&apos;ve logged {study.fsrsLogCount.toLocaleString()} reviews.{" "}
                  {study.usableItems.toLocaleString()} span multiple days, which is enough to fit
                  your personal memory model.
                </>
              ) : (
                <>
                  {study.fsrsLogCount.toLocaleString()} reviews logged so far. Only cards
                  you&apos;ve reviewed across multiple days count here — that&apos;s how FSRS
                  learns how quickly you forget. Keep studying day to day and this will fill up.
                </>
              )}
            </p>
            {study.lastOptimizedAt ? (
              <p style={s.fsrsLastRun}>Last optimized {formatDate(study.lastOptimizedAt)}</p>
            ) : null}
            {optimizeError ? <p style={s.error}>{optimizeError}</p> : null}
          </div>
          <button
            type="button"
            onClick={() => void handleOptimize()}
            disabled={!optimizerReady || optimizing}
            className="btn btn-primary"
            title={
              optimizerReady
                ? "Fit FSRS parameters to your review history"
                : `Need at least ${study.optimizerMinLogs} reviews spanning multiple days to optimize`
            }
          >
            <i className="ri-equalizer-line" />
            {optimizing ? "Optimizing…" : study.lastOptimizedAt ? "Re-optimize" : "Optimize FSRS"}
          </button>
        </div>
      </section>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 24,
  },
  block: {
    display: "flex",
    flexDirection: "column",
    gap: 16,
    paddingBottom: 24,
    borderBottom: "1px solid var(--border-secondary)",
  },
  blockHead: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  blockTitle: {
    font: "600 15px/20px var(--font-sans)",
    color: "var(--fg-primary)",
  },
  blockSub: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    maxWidth: 520,
  },
  fsrsRow: {
    display: "flex",
    alignItems: "center",
    gap: 24,
    flexWrap: "wrap",
  },
  fsrsMeter: { flex: 1, minWidth: 240 },
  fsrsMeterTrack: {
    height: 8,
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-tertiary)",
    borderRadius: 9999,
    overflow: "hidden",
  },
  fsrsMeterLabels: {
    display: "flex",
    justifyContent: "space-between",
    font: "500 13px/18px var(--font-sans)",
    color: "var(--fg-tertiary)",
    marginTop: 8,
    gap: 12,
  },
  fsrsHint: {
    font: "400 12px/17px var(--font-sans)",
    color: "var(--fg-quaternary)",
    margin: "8px 0 0",
    maxWidth: 520,
  },
  fsrsLastRun: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
    margin: "8px 0 0",
  },
  error: {
    width: "100%",
    margin: "8px 0 0",
    font: "500 13px/18px var(--font-sans)",
    color: "var(--grade-again)",
  },
};
