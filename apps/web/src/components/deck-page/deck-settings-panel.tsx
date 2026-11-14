"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { CardSaveStatus } from "@/components/card-save-status";
import { DeckForecastPanel } from "@/components/deck-page/deck-forecast";
import { ReviewOrderFields } from "@/components/review-order-fields";
import { DEFAULT_REVIEW_ORDER, type ReviewOrderSettings } from "@deephaus/shared";
import { useSettings } from "@/components/settings/settings-context";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";

export type DeckStudyValues = {
  desiredRetention: number;
  newCardsPerDay: number;
  /** Review order and limits; missing means the defaults. */
  reviewOrder?: ReviewOrderSettings;
};

export type DeckSettings = DeckStudyValues & {
  useGlobalFsrsSettings?: boolean;
  fsrsParams?: number[];
};

function settingsEqual(a: DeckSettings, b: DeckSettings) {
  return (
    a.desiredRetention === b.desiredRetention &&
    a.newCardsPerDay === b.newCardsPerDay &&
    JSON.stringify(a.reviewOrder ?? null) === JSON.stringify(b.reviewOrder ?? null) &&
    Boolean(a.useGlobalFsrsSettings) === Boolean(b.useGlobalFsrsSettings) &&
    Boolean(a.fsrsParams?.length) === Boolean(b.fsrsParams?.length)
  );
}

function clampNewCards(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(200, parsed));
}

/** FSRS-7 weights have 34 entries; anything else stored on a deck is an older (FSRS-6) preset. */
const FSRS7_WEIGHT_COUNT = 34;

/** Whether a deck's stored preset still schedules its cards: only FSRS-7 weights do. */
export function deckPresetApplies(fsrsParams: number[] | undefined) {
  return fsrsParams?.length === FSRS7_WEIGHT_COUNT;
}

/** Which weights schedule this deck, for the panel and the rail. */
export function schedulingLabel(hasDeckOverride: boolean, hasOptimizedParams: boolean) {
  if (hasDeckOverride) return "Deck preset";
  return hasOptimizedParams ? "Personalized" : "Default";
}

type Props = {
  projectId: string;
  initialSettings: DeckSettings;
  globalSettings: DeckStudyValues;
  hasOptimizedParams: boolean;
  showForecast: boolean;
  onClose: () => void;
};

export function DeckSettingsPanel({
  projectId,
  initialSettings,
  globalSettings,
  hasOptimizedParams,
  showForecast,
  onClose,
}: Props) {
  const router = useRouter();
  const { openSettings } = useSettings();
  const [settings, setSettings] = useState<DeckSettings>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<DeckSettings>(initialSettings);
  const [newCardsInput, setNewCardsInput] = useState(String(initialSettings.newCardsPerDay));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const useGlobal = Boolean(settings.useGlobalFsrsSettings);
  const shown: DeckStudyValues = useGlobal ? globalSettings : settings;
  const dirty = !settingsEqual(settings, savedSettings) || newCardsInput !== String(settings.newCardsPerDay);
  const hasDeckPreset = Boolean(savedSettings.fsrsParams?.length);
  const hasDeckOverride = deckPresetApplies(savedSettings.fsrsParams);

  useEffect(() => {
    setSettings(initialSettings);
    setSavedSettings(initialSettings);
    setNewCardsInput(String(initialSettings.newCardsPerDay));
  }, [initialSettings]);

  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    };
  }, []);

  async function save(next: DeckSettings, opts?: { auto?: boolean; rollbackTo?: DeckSettings }) {
    const auto = Boolean(opts?.auto);
    setSaving(true);
    setError(null);
    if (auto) {
      setAutoSaveError(null);
      setAutoSaveStatus("saving");
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    }
    try {
      const payload: Record<string, unknown> = {
        desiredRetention: next.desiredRetention,
        newCardsPerDay: next.newCardsPerDay,
        useGlobalFsrsSettings: next.useGlobalFsrsSettings ?? false,
      };
      // A deck that keeps its own settings stores its own review order too.
      if (!next.useGlobalFsrsSettings && next.reviewOrder) Object.assign(payload, next.reviewOrder);
      if ((opts?.rollbackTo ?? savedSettings).fsrsParams?.length && !next.fsrsParams?.length) {
        payload.clearFsrsParams = true;
      }
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSettings(next);
      setSavedSettings(next);
      setNewCardsInput(String(next.newCardsPerDay));
      if (auto) {
        setAutoSaveStatus("saved");
        savedFlashTimer.current = setTimeout(() => setAutoSaveStatus("idle"), 1600);
      }
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save settings";
      if (auto) {
        if (opts?.rollbackTo) {
          setSettings(opts.rollbackTo);
          setSavedSettings(opts.rollbackTo);
        }
        setAutoSaveStatus("idle");
        setAutoSaveError(message);
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  // Toggles save straight away, so Reset/Save never flash for one click.
  function persistAuto(next: DeckSettings) {
    const previous = savedSettings;
    setSettings(next);
    setSavedSettings(next);
    void save(next, { auto: true, rollbackTo: previous });
  }

  function toggleGlobal() {
    const checked = !useGlobal;
    persistAuto({
      ...settings,
      useGlobalFsrsSettings: checked,
      ...(checked
        ? {}
        : {
            desiredRetention: settings.desiredRetention || globalSettings.desiredRetention,
            newCardsPerDay: settings.newCardsPerDay || globalSettings.newCardsPerDay,
            reviewOrder: settings.reviewOrder ?? globalSettings.reviewOrder ?? DEFAULT_REVIEW_ORDER,
          }),
    });
  }

  const retentionPct = Math.round(shown.desiredRetention * 100);

  return (
    <aside className="dh-panel dhd-panel" aria-label="Study settings">
      <div className="dh-panel__head">
        <b className="dhd-panel__title">Study settings</b>
        <span className="dh-spacer" />
        <button type="button" className="dhd-icon-btn" aria-label="Close" onClick={onClose}>
          <i className="ri-close-line" aria-hidden />
        </button>
      </div>

      <div className="dh-panel__body">
        <div className="dhd-panel-row dhd-panel-row--rule">
          <div style={{ flex: 1 }}>
            <div className="dhd-strong">Use global defaults</div>
            <div className="dhd-muted">
              Follow your{" "}
              <button type="button" className="dhd-inline-link" onClick={() => openSettings("study")}>
                Study settings
              </button>
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={useGlobal}
            aria-label="Use global defaults"
            className="dh-toggle"
            disabled={saving && autoSaveStatus === "saving"}
            onClick={toggleGlobal}
          />
        </div>

        <label className="dhd-field">
          <span className="dhd-field__label">
            Desired retention
            <b>{retentionPct}%</b>
          </span>
          <input
            type="range"
            className="dhd-range"
            style={{ "--dhd-fill": `${((retentionPct - 70) / 27) * 100}%` } as React.CSSProperties}
            min={70}
            max={97}
            step={1}
            value={retentionPct}
            disabled={useGlobal}
            onChange={(e) =>
              setSettings((current) => ({ ...current, desiredRetention: Number(e.target.value) / 100 }))
            }
          />
          <span className="dhd-help">
            {useGlobal
              ? "Using your global default. Turn off Use global defaults to customize."
              : "Higher means more reviews and fewer lapses."}
          </span>
        </label>

        <label className="dhd-field">
          <span className="dhd-field__label">New cards per day</span>
          <input
            className="input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            disabled={useGlobal}
            value={useGlobal ? String(globalSettings.newCardsPerDay) : newCardsInput}
            onChange={(e) => {
              const next = e.target.value;
              if (next !== "" && !/^\d{1,3}$/.test(next)) return;
              setNewCardsInput(next);
              if (next !== "") {
                setSettings((current) => ({ ...current, newCardsPerDay: clampNewCards(next) }));
              }
            }}
            onBlur={() => {
              const next = clampNewCards(newCardsInput);
              setNewCardsInput(String(next));
              setSettings((current) => ({ ...current, newCardsPerDay: next }));
            }}
          />
        </label>

        <hr className="dhd-rule" />
        <ReviewOrderFields
          idPrefix={`deck-${projectId}`}
          variant="panel"
          value={(useGlobal ? globalSettings.reviewOrder : settings.reviewOrder) ?? DEFAULT_REVIEW_ORDER}
          disabled={useGlobal}
          onChange={(reviewOrder) => setSettings((current) => ({ ...current, reviewOrder }))}
        />

        {showForecast ? (
          <>
            <hr className="dhd-rule" />
            <DeckForecastPanel
              projectId={projectId}
              newPerDay={shown.newCardsPerDay}
              retention={shown.desiredRetention}
            />
          </>
        ) : null}

        <hr className="dhd-rule" />
        <section>
          <div className="dhd-panel-row">
            <b>FSRS parameters</b>
            <span className="dh-spacer" />
            <span className="dh-pill">{schedulingLabel(hasDeckOverride, hasOptimizedParams)}</span>
          </div>
          <p className="dhd-help">
            {hasDeckOverride
              ? "This deck has its own FSRS-7 weights, usually from an Anki import, and they schedule its cards. Clear the preset to use your own weights."
              : hasDeckPreset
                ? "This deck has FSRS-6 weights from an Anki import. Every card is now scheduled with FSRS-7, so they no longer apply, and you can clear them."
                : hasOptimizedParams
                ? "Scheduling uses your globally optimized FSRS weights from Study settings."
                : "Scheduling uses FSRS-7 defaults until you optimize in Study settings."}
          </p>
          {hasDeckPreset ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm dhd-clear"
              disabled={!settings.fsrsParams?.length}
              onClick={() => persistAuto({ ...settings, fsrsParams: undefined })}
            >
              Clear deck override
            </button>
          ) : null}
        </section>

        {error ? <div className="notice notice-error" style={{ marginTop: 16 }}>{error}</div> : null}
      </div>

      <div className="dh-panel__foot dhd-panel__foot">
        <CardSaveStatus status={autoSaveStatus} error={autoSaveError} />
        <span className="dh-spacer" />
        <button
          type="button"
          className="btn btn-ghost"
          disabled={saving || !dirty || useGlobal}
          onClick={() => {
            setSettings(savedSettings);
            setNewCardsInput(String(savedSettings.newCardsPerDay));
          }}
        >
          Reset
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={saving || !dirty || useGlobal}
          onClick={() => void save({ ...settings, newCardsPerDay: clampNewCards(newCardsInput) })}
        >
          {saving && autoSaveStatus !== "saving" ? "Saving…" : "Save"}
        </button>
      </div>
    </aside>
  );
}
