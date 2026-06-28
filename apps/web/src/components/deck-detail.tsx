"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DECK_EXPORT_EVENT } from "@/components/deck-page-header";
import { FadeIn } from "@/components/motion/fade-in";

export type DeckSettings = {
  desiredRetention: number;
  newCardsPerDay: number;
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
};

const TERMINAL = new Set(["ready", "failed"]);

async function readExportError(response: Response): Promise<string> {
  const body = await response.text();
  if (!body) return `Export failed (${response.status})`;
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error ?? body;
  } catch {
    return body;
  }
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
}: Props) {
  const router = useRouter();
  const [liveJobStatus, setLiveJobStatus] = useState(jobStatus);
  const [liveJobProgress, setLiveJobProgress] = useState(jobProgress);
  const [liveJobError, setLiveJobError] = useState(jobError);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<DeckSettings>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<DeckSettings>(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsDirty =
    settings.desiredRetention !== savedSettings.desiredRetention ||
    settings.newCardsPerDay !== savedSettings.newCardsPerDay;

  const generating = liveJobStatus && !TERMINAL.has(liveJobStatus);

  useEffect(() => {
    setLiveJobStatus(jobStatus);
    setLiveJobProgress(jobProgress);
    setLiveJobError(jobError);
  }, [jobStatus, jobProgress, jobError]);

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

  async function saveSettings() {
    setSavingSettings(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedSettings(settings);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  }

  // Topbar 3-dots menu triggers export via a window event (see DeckPageHeader).
  const exportRef = useRef<() => void>(() => {});
  exportRef.current = () => void exportApkg();
  useEffect(() => {
    const handler = () => exportRef.current();
    window.addEventListener(DECK_EXPORT_EVENT, handler);
    return () => window.removeEventListener(DECK_EXPORT_EVENT, handler);
  }, []);

  async function exportApkg() {
    if (!jobId) return;
    setExporting(true);
    setError(null);
    try {
      const res = await fetch("/api/export", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_id: projectId, job_id: jobId }),
      });
      if (!res.ok) throw new Error(await readExportError(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${deckName.replace(/[^a-z0-9-_]+/gi, "-")}.apkg`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
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
          <Link href={`/decks/new?deck=${projectId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
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
          <Link href={`/decks/new?deck=${projectId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
            Add cards
          </Link>
        </div>
      </FadeIn>
    );
  }

  return (
    <>
      <div className="surface" style={{ padding: 20, display: "flex", alignItems: "center", gap: 24, flexWrap: "wrap" }}>
        <Summary value={cardCount} label="Cards" />
        <div style={{ flex: 1, minWidth: 120 }} />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href={`/decks?deck=${projectId}`} className="btn btn-ghost btn-sm">
            <i className="ri-search-line" />
            Browse cards
          </Link>
          <Link href={`/decks/new?deck=${projectId}`} className="btn btn-ghost btn-sm">
            <i className="ri-add-line" />
            Create cards
          </Link>
          <button type="button" onClick={exportApkg} className="btn btn-ghost btn-sm" disabled={exporting || !jobId}>
            <i className="ri-download-line" />
            {exporting ? "Exporting…" : "Export .apkg"}
          </button>
        </div>
      </div>

      <div className="surface" style={{ padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <h3 style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)", margin: 0 }}>
            <i className="ri-equalizer-line" style={{ marginRight: 8, color: "var(--teal-700)" }} />
            Study settings
          </h3>
          {settingsDirty && (
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
          )}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <div>
            <label
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
                {Math.round(settings.desiredRetention * 100)}%
              </strong>
            </label>
            <input
              type="range"
              min={70}
              max={97}
              step={1}
              value={Math.round(settings.desiredRetention * 100)}
              onChange={(e) =>
                setSettings((s) => ({ ...s, desiredRetention: Number(e.target.value) / 100 }))
              }
              style={{ width: "100%", accentColor: "var(--teal-500)" }}
            />
            <p style={{ font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)", marginTop: 6 }}>
              Higher = more frequent reviews, lower workload variance, more total reviews. 90% is the Anki default.
            </p>
          </div>
          <div>
            <label
              style={{
                display: "flex",
                justifyContent: "space-between",
                font: "500 13px/20px var(--font-sans)",
                color: "var(--ink-700)",
                marginBottom: 6,
              }}
            >
              <span>New cards per day</span>
              <strong style={{ color: "var(--ink-900)" }}>{settings.newCardsPerDay}</strong>
            </label>
            <input
              type="number"
              min={0}
              max={200}
              step={1}
              value={settings.newCardsPerDay}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  newCardsPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                }))
              }
              className="input"
              style={{ width: "100%" }}
            />
            <p style={{ font: "400 12px/18px var(--font-sans)", color: "var(--fg-4)", marginTop: 6 }}>
              How many never-seen cards DeepHaus introduces from this deck each day.
            </p>
          </div>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}
    </>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 12px" }}>
      <span style={{ font: "600 24px/1 var(--font-sans)", color: "var(--ink-900)", letterSpacing: "-0.02em" }}>
        {value}
      </span>
      <span style={{ color: "var(--fg-4)", font: "400 12px/16px var(--font-sans)", marginTop: 4 }}>{label}</span>
    </div>
  );
}
