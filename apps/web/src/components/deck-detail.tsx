"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FadeIn } from "@/components/motion/fade-in";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";
import { CardSaveStatus } from "@/components/card-save-status";
import { cardTypeLabel } from "@deephaus/shared";
import { CardFieldEditor } from "@/components/card-field-editor";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { useAutoSaveCard } from "@/hooks/use-auto-save-card";
import { buildCardUpdateBody, cardUpdateSnapshot, updateCardApi } from "@/lib/cards/update";
import "@/components/rich-text/rich-text.css";

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
  const [localCards, setLocalCards] = useState(cards);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<DeckCard>>({});
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
    setLocalCards(cards);
  }, [cards]);

  const editingCard = useMemo(
    () => localCards.find((c) => c.id === editing) ?? null,
    [localCards, editing],
  );

  const saveSnapshot = useMemo(() => {
    if (!editingCard) return "";
    return cardUpdateSnapshot({
      type: editingCard.type,
      front: draft.front ?? editingCard.front,
      back: draft.back ?? editingCard.back,
      cloze_text: draft.cloze_text ?? editingCard.cloze_text,
      extra: draft.extra ?? editingCard.extra,
    });
  }, [editingCard, draft]);

  const persistEdit = useCallback(async () => {
    if (!editingCard) return;
    const body = buildCardUpdateBody({
      type: editingCard.type,
      front: draft.front ?? editingCard.front,
      back: draft.back ?? editingCard.back,
      cloze_text: draft.cloze_text ?? editingCard.cloze_text,
      extra: draft.extra ?? editingCard.extra,
    });
    const saved = await updateCardApi<DeckCard>(editingCard.id, body);
    setLocalCards((prev) =>
      prev.map((c) => (c.id === saved.id ? { ...c, ...saved } : c)),
    );
  }, [editingCard, draft]);

  const { status: saveStatus, error: saveError } = useAutoSaveCard({
    cardId: editing,
    snapshot: saveSnapshot,
    enabled: Boolean(editingCard),
    save: persistEdit,
  });

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

  const summary = useMemo(() => {
    const total = localCards.length;
    const basic = localCards.filter((c) => c.type === "basic").length;
    const cloze = localCards.filter((c) => c.type === "cloze").length;
    return { total, basic, cloze };
  }, [localCards]);

  function startEdit(card: DeckCard) {
    setEditing(card.id);
    setDraft({
      ...card,
      back: card.type === "basic" ? card.back ?? card.extra : card.back,
      extra: card.type === "basic" ? null : card.extra,
    });
  }

  function cancelEdit() {
    setEditing(null);
    setDraft({});
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

  if (liveJobStatus === "failed" && localCards.length === 0) {
    return (
      <FadeIn>
        <div className="surface" style={{ padding: 32, textAlign: "center" }}>
        <i className="ri-error-warning-line" style={{ fontSize: 36, color: "var(--grade-again)" }} />
        <h3 style={{ font: "500 18px/24px var(--font-sans)", color: "var(--ink-900)", marginTop: 12 }}>
          Generation failed
        </h3>
        <p style={{ color: "var(--fg-3)", marginTop: 4 }}>{liveJobError ?? "Try generating again with different settings."}</p>
        <Link href={`/decks/new?deck=${projectId}`} className="btn btn-primary" style={{ marginTop: 16 }}>
          Try Again
        </Link>
        </div>
      </FadeIn>
    );
  }

  if (generating && localCards.length === 0) {
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

  if (localCards.length === 0) {
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
      <div className="surface" style={{ padding: 20, display: "flex", alignItems: "center", gap: 24 }}>
        <Summary value={summary.total} label="Total" />
        <Divider />
        <Summary value={summary.basic} label="Front/Back" />
        <Divider />
        <Summary value={summary.cloze} label="Fill-in-the-Blank" />
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
              How many never-seen cards DeepHaus introduces from this deck each day.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="notice notice-error">{error}</div>
      )}

      <div className="surface" style={{ padding: 0 }}>
        <StaggerList style={{ display: "flex", flexDirection: "column" }}>
        {localCards.map((card, i) => (
          <StaggerItem
            key={card.id}
            style={{
              padding: 20,
              borderBottom: i === localCards.length - 1 ? 0 : "1px solid var(--border-1)",
              display: "flex",
              gap: 20,
              alignItems: "flex-start",
            }}
          >
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
              {editing === card.id ? (
                <>
                  <CardFieldEditor
                    label="Front"
                    cardId={card.id}
                    allowCloze={card.type === "cloze"}
                    value={
                      card.type === "cloze" ? (draft.cloze_text ?? "") : (draft.front ?? "")
                    }
                    onChange={(value) =>
                      setDraft((d) =>
                        card.type === "cloze"
                          ? { ...d, cloze_text: value }
                          : { ...d, front: value },
                      )
                    }
                    placeholder={card.type === "cloze" ? "Cloze text" : "Front"}
                  />
                  {card.type !== "cloze" && (
                    <CardFieldEditor
                      label="Back"
                      cardId={card.id}
                      value={draft.back ?? draft.extra ?? ""}
                      onChange={(value) =>
                        setDraft((d) => ({ ...d, back: value, extra: null }))
                      }
                      placeholder="Back"
                    />
                  )}
                  {card.type === "cloze" && (
                    <CardFieldEditor
                      label="Back"
                      cardId={card.id}
                      value={draft.extra ?? ""}
                      onChange={(value) => setDraft((d) => ({ ...d, extra: value }))}
                      placeholder="Answer shown on reveal"
                    />
                  )}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
                    <CardSaveStatus status={saveStatus} error={saveError} />
                    <button type="button" className="btn btn-ghost btn-sm" onClick={cancelEdit}>
                      Done
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className={card.type === "cloze" ? "chip chip-new" : "chip chip-neutral"}>
                      {cardTypeLabel(card.type, "short")}
                    </span>
                    {card.user_edited && <span className="chip chip-neutral">Edited</span>}
                  </div>
                  {card.type === "cloze" ? (
                    <CardContentRenderer
                      content={card.cloze_text}
                      style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)" }}
                    />
                  ) : (
                    <>
                      <CardContentRenderer
                        content={card.front}
                        style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-900)" }}
                      />
                      {(card.back || card.extra) && (
                        <CardContentRenderer
                          content={card.back ?? card.extra}
                          style={{ color: "var(--fg-3)", font: "400 14px/22px var(--font-sans)" }}
                        />
                      )}
                    </>
                  )}
                  {card.type === "cloze" && card.extra && (
                    <CardContentRenderer
                      content={card.extra}
                      style={{ color: "var(--fg-3)", font: "400 14px/22px var(--font-sans)" }}
                    />
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
          </StaggerItem>
        ))}
        </StaggerList>
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
