"use client";

import { parseEasyDays, type EasyDays, type ReviewOrderSettings } from "@deephaus/shared";
import { EasyDaysSettings } from "@/components/easy-days-settings";
import { ReviewOrderFields } from "@/components/review-order-fields";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FsrsSettingsFields } from "@/components/fsrs-settings-fields";
import { SettingsLoadingState, type SettingsStudyData } from "@/components/settings/settings-shell";

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
  easyDays: EasyDays;
  desiredRetention: number;
  newCardsPerDay: number;
  dayStartHour: number;
  reviewOrder: ReviewOrderSettings;
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

  // Study data arrives async; seed the form once.
  useEffect(() => {
    if (!study || settings) return;
    const initial = {
      easyDays: parseEasyDays(study.easyDays),
      desiredRetention: study.desiredRetention,
      newCardsPerDay: study.newCardsPerDay,
      dayStartHour: study.dayStartHour,
      reviewOrder: study.reviewOrder,
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
    settings.dayStartHour !== savedSettings.dayStartHour ||
    JSON.stringify(settings.easyDays) !== JSON.stringify(savedSettings.easyDays) ||
    JSON.stringify(settings.reviewOrder) !== JSON.stringify(savedSettings.reviewOrder);

  const optimizerReady = study.usableItems >= study.optimizerMinLogs;
  const optimizerProgress = Math.min(study.usableItems / study.optimizerMinLogs, 1);
  const usableRemaining = Math.max(0, study.optimizerMinLogs - study.usableItems);

  async function save() {
    if (!settings?.easyDays.includes("normal")) return;
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
    <>
      <section className="dhs-sec">
        <h2>Defaults</h2>
        <p className="dhs-lede">
          These apply to new decks and any deck using global settings. Each deck can override them.
        </p>
        <FsrsSettingsFields
          idPrefix="settings-global"
          values={settings}
          compact
          onChange={(patch) => setSettings((current) => ({ ...current!, ...patch }))}
        />
        <div className="dhs-row dhs-row--flush">
          <label className="dhs-row__main" htmlFor="settings-global-day-start">
            Next day starts at
          </label>
          <select
            id="settings-global-day-start"
            className="input dhs-select"
            value={settings.dayStartHour}
            disabled={saving}
            onChange={(e) =>
              setSettings((current) => ({ ...current!, dayStartHour: Number(e.target.value) }))
            }
          >
            {Array.from({ length: 24 }, (_, hour) => (
              <option key={hour} value={hour}>
                {hour === 0 ? "Midnight" : formatRolloverHour(hour)}
              </option>
            ))}
          </select>
        </div>
        <p className="dhs-help">
          Reviews before this hour count toward the previous day, and new-card limits reset at this
          time. Anki&apos;s default is 4:00 AM.
        </p>
      </section>

      <section className="dhs-sec">
        <h2>Review order</h2>
        <p className="dhs-lede">
          How each deck lays out a day&apos;s cards, after Anki&apos;s display order and limits. Decks
          using global settings follow these; others can set their own.
        </p>
        <ReviewOrderFields
          idPrefix="settings-global"
          variant="settings"
          value={settings.reviewOrder}
          disabled={saving}
          onChange={(reviewOrder) => setSettings((current) => ({ ...current!, reviewOrder }))}
        />
      </section>

      <EasyDaysSettings
        value={settings.easyDays}
        disabled={saving}
        onChange={(easyDays) => setSettings((current) => ({ ...current!, easyDays }))}
      />

      <section className="dhs-sec">
        <h2>Adaptive learning</h2>
        <div className="dhs-meter-head">
          <span>Trainable reviews</span>
          <span className="dhs-tnum">
            {study.usableItems.toLocaleString()} / {study.optimizerMinLogs.toLocaleString()}
          </span>
        </div>
        <div
          className="dh-meter"
          role="progressbar"
          aria-label="Trainable reviews"
          aria-valuemin={0}
          aria-valuemax={study.optimizerMinLogs}
          aria-valuenow={Math.min(study.usableItems, study.optimizerMinLogs)}
        >
          <span style={{ width: `${optimizerProgress * 100}%` }} />
        </div>
        <button
          type="button"
          onClick={() => void handleOptimize()}
          disabled={!optimizerReady || optimizing}
          className="btn btn-secondary btn-sm dhs-meter-action"
          title={
            optimizerReady
              ? "Fit FSRS parameters to your review history"
              : `Need at least ${study.optimizerMinLogs} reviews spanning multiple days to optimize`
          }
        >
          {optimizing ? "Optimizing…" : study.lastOptimizedAt ? "Re-optimize" : "Optimize FSRS"}
        </button>
        <p className="dhs-help">
          {optimizerReady
            ? `${study.usableItems.toLocaleString()} of your ${study.fsrsLogCount.toLocaleString()} reviews are repeats the scheduler can learn from, enough to fit FSRS-7 to your memory.`
            : `Needs ${usableRemaining.toLocaleString()} more ${usableRemaining === 1 ? "review" : "reviews"} before DeepHaus can fit FSRS-7 to your memory. Each review after a card's first one counts, and ${study.fsrsLogCount.toLocaleString()} are logged so far.`}
        </p>
        {study.lastOptimizedAt ? (
          <p className="dhs-help">Last optimized {formatDate(study.lastOptimizedAt)}</p>
        ) : null}
        {optimizeError ? <p className="dhs-error">{optimizeError}</p> : null}
      </section>

      {dirty || error ? (
        <div className="dhs-savebar">
          {error ? (
            <span className="dhs-error">{error}</span>
          ) : (
            <span className="dhs-muted">Unsaved changes</span>
          )}
          <span className="dh-spacer" />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setSettings(savedSettings);
              setError(null);
            }}
            disabled={saving}
          >
            Reset
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => void save()}
            disabled={saving || !dirty || !settings.easyDays.includes("normal")}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      ) : null}
    </>
  );
}
