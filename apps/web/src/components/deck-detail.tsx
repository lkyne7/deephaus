"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useSettings } from "@/components/settings/settings-context";
import { FadeIn } from "@/components/motion/fade-in";
import { CardSaveStatus } from "@/components/card-save-status";
import {
  FsrsSettingsFields,
  type FsrsSettingsValues,
} from "@/components/fsrs-settings-fields";
import type { AutoSaveStatus } from "@/hooks/use-auto-save-card";

export type DeckSettings = FsrsSettingsValues & {
  useGlobalFsrsSettings?: boolean;
  fsrsParams?: number[];
};

type Props = {
  projectId: string;
  jobId: string | null;
  jobStatus: string | null;
  jobError: string | null;
  jobProgress: number;
  deckName: string;
  cardCount: number;
  initialSettings: DeckSettings;
  globalSettings: FsrsSettingsValues;
  hasOptimizedParams: boolean;
};

const TERMINAL = new Set(["ready", "failed"]);

function settingsEqual(a: DeckSettings, b: DeckSettings) {
  return (
    a.desiredRetention === b.desiredRetention &&
    a.newCardsPerDay === b.newCardsPerDay &&
    Boolean(a.useGlobalFsrsSettings) === Boolean(b.useGlobalFsrsSettings) &&
    Boolean(a.fsrsParams?.length) === Boolean(b.fsrsParams?.length)
  );
}

export function DeckDetail({
  projectId,
  jobId,
  jobStatus,
  jobError,
  jobProgress,
  deckName,
  cardCount,
  initialSettings,
  globalSettings,
  hasOptimizedParams,
}: Props) {
  const router = useRouter();
  const { openSettings } = useSettings();
  const [liveJobStatus, setLiveJobStatus] = useState(jobStatus);
  const [liveJobProgress, setLiveJobProgress] = useState(jobProgress);
  const [liveJobError, setLiveJobError] = useState(jobError);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<DeckSettings>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<DeckSettings>(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [autoSaveStatus, setAutoSaveStatus] = useState<AutoSaveStatus>("idle");
  const [autoSaveError, setAutoSaveError] = useState<string | null>(null);
  const savedFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const settingsDirty = !settingsEqual(settings, savedSettings);

  const useGlobal = Boolean(settings.useGlobalFsrsSettings);
  const displayValues: FsrsSettingsValues = useGlobal ? globalSettings : settings;
  const hasDeckFsrsOverride = Boolean(savedSettings.fsrsParams?.length);
  // Retention/new-card edits only need Save/Reset when customized for this deck.
  // Global-default toggles (and clear-override) save immediately via status chip.
  const showSettingsActions = settingsDirty && !useGlobal;

  const generating = liveJobStatus && !TERMINAL.has(liveJobStatus);

  useEffect(() => {
    setLiveJobStatus(jobStatus);
    setLiveJobProgress(jobProgress);
    setLiveJobError(jobError);
  }, [jobStatus, jobProgress, jobError]);

  useEffect(() => {
    setSettings(initialSettings);
    setSavedSettings(initialSettings);
  }, [initialSettings]);

  useEffect(() => {
    return () => {
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!jobId || (jobStatus && TERMINAL.has(jobStatus))) return;

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    async function pollJob() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { credentials: "include" });
        if (!res.ok || cancelled) return;
        const job = (await res.json()) as { status?: string; progress?: number; error?: string | null };
        if (cancelled) return;
        const nextStatus = job.status ?? null;
        setLiveJobStatus(nextStatus);
        setLiveJobProgress(typeof job.progress === "number" ? job.progress : 0);
        if (job.error) setLiveJobError(job.error);
        if (nextStatus && TERMINAL.has(nextStatus)) {
          if (interval) clearInterval(interval);
          router.refresh();
        }
      } catch {
        // ignore transient poll errors
      }
    }

    void pollJob();
    interval = setInterval(() => void pollJob(), 2000);
    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
    };
  }, [jobId, jobStatus, router]);

  async function saveSettings(
    nextSettings: DeckSettings = settings,
    opts?: { auto?: boolean; rollbackTo?: DeckSettings },
  ) {
    const auto = Boolean(opts?.auto);
    setSavingSettings(true);
    setError(null);
    if (auto) {
      setAutoSaveError(null);
      setAutoSaveStatus("saving");
      if (savedFlashTimer.current) clearTimeout(savedFlashTimer.current);
    }
    try {
      const payload: Record<string, unknown> = {
        desiredRetention: nextSettings.desiredRetention,
        newCardsPerDay: nextSettings.newCardsPerDay,
        useGlobalFsrsSettings: nextSettings.useGlobalFsrsSettings ?? false,
      };
      if (
        (opts?.rollbackTo ?? savedSettings).fsrsParams?.length &&
        !nextSettings.fsrsParams?.length
      ) {
        payload.clearFsrsParams = true;
      }

      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: payload }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSettings(nextSettings);
      setSavedSettings(nextSettings);
      if (auto) {
        setAutoSaveStatus("saved");
        savedFlashTimer.current = setTimeout(() => setAutoSaveStatus("idle"), 1600);
      }
      router.refresh();
    } catch (e) {
      const message = e instanceof Error ? e.message : "Failed to save settings";
      setError(message);
      if (auto) {
        if (opts?.rollbackTo) {
          setSettings(opts.rollbackTo);
          setSavedSettings(opts.rollbackTo);
        }
        setAutoSaveStatus("idle");
        setAutoSaveError(message);
      }
    } finally {
      setSavingSettings(false);
    }
  }

  function persistAuto(next: DeckSettings) {
    const previous = savedSettings;
    // Mark saved immediately so Reset/Save never flash for one-click toggles.
    setSettings(next);
    setSavedSettings(next);
    void saveSettings(next, { auto: true, rollbackTo: previous });
  }

  function clearDeckFsrsOverride() {
    persistAuto({ ...settings, fsrsParams: undefined });
  }

  if (liveJobStatus === "failed" && cardCount === 0) {
    return (
      <FadeIn>
        <div className="surface" style={{ padding: 32, textAlign: "center" }}>
          <i className="ri-error-warning-line" style={{ fontSize: 36, color: "var(--grade-again)" }} />
          <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", marginTop: 12 }}>
            Generation failed
          </h3>
          <p style={{ color: "var(--fg-3)", marginTop: 4 }}>
            {liveJobError ?? "Try generating again with different settings."}
          </p>
          <Link href={`/create?deck=${projectId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
            Try Again
          </Link>
        </div>
      </FadeIn>
    );
  }

  if (generating && cardCount === 0) {
    return (
      <FadeIn>
        <div className="surface" style={{ padding: 48, textAlign: "center" }}>
          <i className="ri-magic-line icon-spin" style={{ fontSize: 32, color: "var(--teal-500)" }} />
          <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", marginTop: 12 }}>
            Generating your flashcards…
          </h3>
          <p style={{ color: "var(--fg-3)", marginTop: 4 }}>This usually takes a few seconds.</p>
          <div
            style={{
              margin: "20px auto 0",
              width: 280,
              height: 6,
              background: "var(--ink-25)",
              borderRadius: 9999,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.max(liveJobProgress, generating ? 30 : 5)}%`,
                height: "100%",
                background: "var(--teal-500)",
                transition: "width .4s",
              }}
            />
          </div>
        </div>
      </FadeIn>
    );
  }

  if (cardCount === 0) {
    return (
      <FadeIn>
        <div className="surface" style={{ padding: 48, textAlign: "center" }}>
          <i className="ri-stack-line" style={{ fontSize: 32, color: "var(--ink-300)" }} />
          <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", marginTop: 12 }}>
            No cards yet
          </h3>
          <p style={{ color: "var(--fg-3)", marginTop: 4 }}>Add a source to generate cards for this deck.</p>
          <Link href={`/create?deck=${projectId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
            Add cards
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <>
      <div className="surface" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)", margin: 0 }}>
            <i className="ri-equalizer-line" style={{ marginRight: 8, color: "var(--teal-700)" }} />
            FSRS study settings
          </h3>
          {showSettingsActions ? (
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSettings(savedSettings)}
                disabled={savingSettings}
              >
                Reset
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => void saveSettings()}
                disabled={savingSettings}
              >
                {savingSettings ? "Saving…" : "Save"}
              </button>
            </div>
          ) : (
            <CardSaveStatus status={autoSaveStatus} error={autoSaveError} />
          )}
        </div>

        <label style={s.toggleRow}>
          <input
            type="checkbox"
            checked={useGlobal}
            disabled={savingSettings && autoSaveStatus === "saving"}
            onChange={(e) => {
              const checked = e.target.checked;
              persistAuto({
                ...settings,
                useGlobalFsrsSettings: checked,
                ...(checked
                  ? {}
                  : {
                      desiredRetention:
                        settings.desiredRetention || globalSettings.desiredRetention,
                      newCardsPerDay: settings.newCardsPerDay || globalSettings.newCardsPerDay,
                    }),
              });
            }}
          />
          <span>
            <strong style={{ color: "var(--ink-900)" }}>Use global defaults</strong>
            <span style={s.toggleHint}>
              {" "}
              — inherit retention and new-card limits from your{" "}
              <button
                type="button"
                onClick={() => openSettings("study")}
                style={{
                  border: 0,
                  padding: 0,
                  background: "transparent",
                  color: "var(--fg-brand)",
                  font: "inherit",
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                settings
              </button>
            </span>
          </span>
        </label>

        <div style={{ marginTop: 20 }}>
          <FsrsSettingsFields
            idPrefix={`deck-${projectId}`}
            values={displayValues}
            inheritedFromGlobal={useGlobal}
            onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          />
        </div>

        <div style={s.paramsBlock}>
          <div style={s.paramsHead}>
            <span style={s.paramsTitle}>FSRS parameters</span>
            {hasDeckFsrsOverride ? (
              <span className="chip chip-neutral">Deck preset</span>
            ) : hasOptimizedParams ? (
              <span className="chip chip-neutral">Personalized</span>
            ) : (
              <span className="chip chip-neutral">Default</span>
            )}
          </div>
          <p style={s.paramsBody}>
            {hasDeckFsrsOverride
              ? "This deck uses its own FSRS weights (typically imported from Anki). Clear the override to use your global optimized parameters instead."
              : hasOptimizedParams
                ? "Scheduling uses your globally optimized FSRS weights from the profile page."
                : "Scheduling uses FSRS-5 defaults until you optimize on your profile page."}
          </p>
          {hasDeckFsrsOverride && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={clearDeckFsrsOverride}
              disabled={!settings.fsrsParams?.length}
            >
              Clear deck override
            </button>
          )}
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  toggleRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    font: "400 14px/22px var(--font-sans)",
    color: "var(--fg-tertiary)",
  },
  toggleHint: {
    color: "var(--fg-quaternary)",
  },
  paramsBlock: {
    marginTop: 24,
    paddingTop: 20,
    borderTop: "1px solid var(--border-secondary)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  paramsHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  paramsTitle: {
    font: "500 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  paramsBody: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: 0,
    maxWidth: 640,
  },
};
