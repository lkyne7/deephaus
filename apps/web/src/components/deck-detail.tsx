"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

export type DeckCard = {
  id: string;
  job_id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  sort_order: number;
  user_edited: boolean;
};

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
  cards: DeckCard[];
  initialSettings: DeckSettings;
};

const TERMINAL = new Set(["ready", "failed"]);

export function DeckDetail({
  projectId,
  jobId,
  jobStatus,
  jobError,
  jobProgress,
  deckName,
  cards,
  initialSettings,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<DeckCard>>({});
  const [polling, setPolling] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<DeckSettings>(initialSettings);
  const [savedSettings, setSavedSettings] = useState<DeckSettings>(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const settingsDirty =
    settings.desiredRetention !== savedSettings.desiredRetention ||
    settings.newCardsPerDay !== savedSettings.newCardsPerDay;

  const generating = jobStatus && !TERMINAL.has(jobStatus);

  useEffect(() => {
    if (!generating) return;
    setPolling(true);
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [generating, router]);

  const summary = useMemo(() => {
    const total = cards.length;
    const basic = cards.filter((c) => c.type === "basic").length;
    const cloze = cards.filter((c) => c.type === "cloze").length;
    return { total, basic, cloze };
  }, [cards]);

  function startEdit(card: DeckCard) {
    setEditing(card.id);
    setDraft({ ...card });
  }

  function cancelEdit() {
    setEditing(null);
    setDraft({});
  }

  async function saveEdit(id: string) {
    try {
      const res = await fetch(`/api/cards/${id}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          front: draft.front ?? null,
          back: draft.back ?? null,
          cloze_text: draft.cloze_text ?? null,
          extra: draft.extra ?? null,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      setEditing(null);
      setDraft({});
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  }

  async function deleteCard(id: string) {
    if (!confirm("Delete this card? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/cards/${id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok && res.status !== 204) throw new Error(await res.text());
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

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
      if (!res.ok) throw new Error(await res.text());
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

  if (jobStatus === "failed") {
    return (
      <div className="surface" style={{ padding: 32, textAlign: "center" }}>
        <i className="ri-error-warning-line" style={{ fontSize: 36, color: "var(--grade-again)" }} />
        <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", marginTop: 12 }}>
          Generation failed
        </h3>
        <p style={{ color: "var(--fg-3)", marginTop: 4 }}>{jobError ?? "Try generating again with different settings."}</p>
        <Link href="/decks/new" className="btn btn-primary" style={{ marginTop: 16 }}>
          Try Again
        </Link>
      </div>
    );
  }

  if (generating || (cards.length === 0 && jobStatus !== "ready")) {
    return (
      <div className="surface" style={{ padding: 48, textAlign: "center" }}>
        <i className="ri-magic-line" style={{ fontSize: 32, color: "var(--teal-500)" }} />
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
              width: `${Math.max(jobProgress, polling ? 30 : 5)}%`,
              height: "100%",
              background: "var(--teal-500)",
              transition: "width .4s",
            }}
          />
        </div>
      </div>
    );
  }

  if (cards.length === 0) {
    return (
      <div className="surface" style={{ padding: 48, textAlign: "center" }}>
        <i className="ri-stack-line" style={{ fontSize: 32, color: "var(--ink-300)" }} />
        <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", marginTop: 12 }}>
          No cards yet
        </h3>
        <p style={{ color: "var(--fg-3)", marginTop: 4 }}>Add a source to generate cards for this deck.</p>
        <Link href="/decks/new" className="btn btn-primary" style={{ marginTop: 16 }}>
          Create Deck
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="surface" style={{ padding: 20, display: "flex", alignItems: "center", gap: 24 }}>
        <Summary value={summary.total} label="Total" />
        <Divider />
        <Summary value={summary.basic} label="Basic" />
        <Divider />
        <Summary value={summary.cloze} label="Cloze" />
        <div style={{ flex: 1 }} />
        <button onClick={exportApkg} className="btn btn-ghost" disabled={exporting || !jobId}>
          <i className="ri-download-line" />
          {exporting ? "Exporting…" : "Export .apkg"}
        </button>
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
                className="btn btn-ghost btn-sm"
                onClick={() => setSettings(savedSettings)}
                disabled={savingSettings}
              >
                Reset
              </button>
              <button
                className="btn btn-primary btn-sm"
                onClick={saveSettings}
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
              style={{ width: "100%" }}
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
              How many never-seen cards Sluggo introduces from this deck each day.
            </p>
          </div>
        </div>
      </div>

      {error && <div className="notice notice-error">{error}</div>}

      <div className="surface" style={{ padding: 0 }}>
        {cards.map((card, i) => (
          <div
            key={card.id}
            style={{
              padding: 20,
              borderBottom: i === cards.length - 1 ? 0 : "1px solid var(--border-1)",
              display: "flex",
              gap: 20,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {editing === card.id ? (
                <>
                  {card.type === "cloze" ? (
                    <textarea
                      className="textarea"
                      value={draft.cloze_text ?? ""}
                      onChange={(e) => setDraft((d) => ({ ...d, cloze_text: e.target.value }))}
                      style={{ minHeight: 100 }}
                    />
                  ) : (
                    <>
                      <textarea
                        className="textarea"
                        placeholder="Front"
                        value={draft.front ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, front: e.target.value }))}
                        style={{ minHeight: 80 }}
                      />
                      <textarea
                        className="textarea"
                        placeholder="Back"
                        value={draft.back ?? ""}
                        onChange={(e) => setDraft((d) => ({ ...d, back: e.target.value }))}
                        style={{ minHeight: 80 }}
                      />
                    </>
                  )}
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <button className="btn btn-primary btn-sm" onClick={() => saveEdit(card.id)}>
                      Save
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className={card.type === "cloze" ? "chip chip-new" : "chip chip-neutral"}>
                      {card.type === "cloze" ? "Cloze" : "Basic"}
                    </span>
                    {card.user_edited && <span className="chip chip-neutral">Edited</span>}
                  </div>
                  {card.type === "cloze" ? (
                    <div style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)" }}>
                      {card.cloze_text}
                    </div>
                  ) : (
                    <>
                      <div style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)" }}>{card.front}</div>
                      <div style={{ color: "var(--fg-3)", font: "400 14px/22px var(--font-sans)" }}>{card.back}</div>
                    </>
                  )}
                  {card.extra && (
                    <div style={{ color: "var(--fg-4)", font: "400 13px/20px var(--font-sans)", marginTop: 4 }}>
                      {card.extra}
                    </div>
                  )}
                </>
              )}
            </div>

            {editing !== card.id && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => startEdit(card)}
                  style={{ padding: "6px 12px" }}
                >
                  <i className="ri-pencil-line" />
                  Edit
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => deleteCard(card.id)}
                  style={{ padding: "6px 12px", color: "var(--grade-again)" }}
                >
                  <i className="ri-delete-bin-line" />
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  );
}

function Summary({ value, label }: { value: number; label: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "0 12px" }}>
      <span style={{ font: "600 28px/1 var(--font-sans)", color: "var(--ink-900)", letterSpacing: "-0.02em" }}>
        {value}
      </span>
      <span style={{ color: "var(--fg-4)", font: "400 12px/16px var(--font-sans)", marginTop: 4 }}>{label}</span>
    </div>
  );
}

function Divider() {
  return <span style={{ width: 1, height: 32, background: "var(--border-1)" }} />;
}
