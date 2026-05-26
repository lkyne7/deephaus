"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import type { DeckPublication } from "@/lib/community/types";
import { cardTypeLabel } from "@deephaus/shared";
import { cardAnswerText } from "@/lib/browse/cards";
import "@/components/rich-text/rich-text.css";

type PreviewCard = {
  id: string;
  type: "basic" | "cloze";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
};

type DeckOverview = {
  id: string;
  title: string;
  card_count: number;
  basic_count: number;
  cloze_count: number;
  counts: { due: number; new: number; new_today_remaining: number };
  settings: { desiredRetention: number; newCardsPerDay: number };
  publication: DeckPublication | null;
  preview_cards: PreviewCard[];
};

type Props = {
  deckId: string | null;
  onClose: () => void;
};

function truncate(text: string, max = 120) {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

export function DeckOverviewModal({ deckId, onClose }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<DeckOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [settings, setSettings] = useState({ desiredRetention: 0.9, newCardsPerDay: 10 });
  const [savedSettings, setSavedSettings] = useState(settings);
  const [publication, setPublication] = useState<DeckPublication | null>(null);
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/decks/${id}/overview`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not load deck");
      }
      const data = (await res.json()) as DeckOverview;
      setOverview(data);
      setSettings(data.settings);
      setSavedSettings(data.settings);
      setPublication(data.publication);
      setDescription(data.publication?.description ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load deck");
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!deckId) {
      setOverview(null);
      setError(null);
      return;
    }
    void loadOverview(deckId);
  }, [deckId, loadOverview]);

  const settingsDirty =
    settings.desiredRetention !== savedSettings.desiredRetention ||
    settings.newCardsPerDay !== savedSettings.newCardsPerDay;

  async function saveSettings() {
    if (!deckId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${deckId}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings }),
      });
      if (!res.ok) throw new Error(await res.text());
      setSavedSettings(settings);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setBusy(false);
    }
  }

  async function publish() {
    if (!deckId || !overview) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/community/publish", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: deckId,
          title: overview.title,
          description: description.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Publish failed");
      }
      const data = (await res.json()) as DeckPublication;
      setPublication(data);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Publish failed");
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!deckId) return;
    if (!confirm("Remove this deck from Community? Existing subscribers keep their copies.")) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/community/publish?project_id=${deckId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unpublish failed");
      }
      setPublication(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unpublish failed");
    } finally {
      setBusy(false);
    }
  }

  const canStudy = overview ? overview.counts.due + overview.counts.new > 0 : false;

  return (
    <AnimatedModal
      title={overview?.title ?? "Deck"}
      open={Boolean(deckId)}
      onClose={onClose}
      maxWidth={760}
    >
      {loading ? (
        <div style={s.centered}>
          <i className="ri-loader-4-line icon-spin" style={{ fontSize: 28, color: "var(--ink-300)" }} />
        </div>
      ) : error && !overview ? (
        <div className="notice notice-error">{error}</div>
      ) : overview ? (
        <div style={s.body}>
          <div style={s.statsRow}>
            <span className="chip chip-neutral">
              <i className="ri-stack-line" style={{ marginRight: 4 }} />
              {overview.card_count} cards
            </span>
            <span className="chip chip-due">
              <span className="chip-dot" />
              {overview.counts.due} due
            </span>
            <span className="chip chip-new">
              <span className="chip-dot" />
              {overview.counts.new} new
            </span>
            <span className="chip chip-neutral">{overview.basic_count} Front/Back</span>
            <span className="chip chip-neutral">{overview.cloze_count} Fill-in-the-Blank</span>
          </div>

          <div style={s.columns}>
            <div style={s.mainCol}>
              <section style={s.section}>
                <h3 style={s.sectionTitle}>Description</h3>
                <p style={s.sectionHint}>Shown on Community when this deck is published.</p>
                <textarea
                  className="textarea"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={3}
                  placeholder="What is this deck about?"
                  disabled={overview.card_count === 0}
                />
              </section>

              <section style={s.section}>
                <h3 style={s.sectionTitle}>Community</h3>
                <p style={s.sectionHint}>
                  {publication
                    ? `Published · ${publication.subscriber_count} subscriber${publication.subscriber_count === 1 ? "" : "s"}`
                    : "Share this deck so others can preview and subscribe."}
                </p>
                {overview.card_count > 0 ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void publish()} disabled={busy}>
                      {busy ? "Saving…" : publication ? "Republish updates" : "Publish to Community"}
                    </button>
                    {publication ? (
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => void unpublish()} disabled={busy}>
                        Unpublish
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p style={s.sectionHint}>Add cards before publishing.</p>
                )}
              </section>

              <section style={s.section}>
                <div style={s.sectionHeader}>
                  <h3 style={s.sectionTitle}>Study settings</h3>
                  {settingsDirty ? (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveSettings()} disabled={busy}>
                      Save settings
                    </button>
                  ) : null}
                </div>
                <div style={s.settingsGrid}>
                  <div className="field">
                    <label className="field-label" style={s.rangeLabel}>
                      <span>Desired retention</span>
                      <strong>{Math.round(settings.desiredRetention * 100)}%</strong>
                    </label>
                    <input
                      type="range"
                      min={70}
                      max={97}
                      step={1}
                      value={Math.round(settings.desiredRetention * 100)}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          desiredRetention: Number(e.target.value) / 100,
                        }))
                      }
                      style={{ width: "100%", accentColor: "var(--teal-500)" }}
                    />
                  </div>
                  <div className="field">
                    <label className="field-label" htmlFor="new-cards-per-day">
                      New cards per day
                    </label>
                    <input
                      id="new-cards-per-day"
                      className="input"
                      type="number"
                      min={0}
                      max={200}
                      value={settings.newCardsPerDay}
                      onChange={(e) =>
                        setSettings((prev) => ({
                          ...prev,
                          newCardsPerDay: Math.max(0, Math.min(200, Number(e.target.value) || 0)),
                        }))
                      }
                    />
                  </div>
                </div>
              </section>
            </div>

            <aside style={s.previewCol}>
              <h3 style={s.sectionTitle}>Preview</h3>
              {overview.preview_cards.length === 0 ? (
                <div style={s.previewEmpty}>No cards yet</div>
              ) : (
                <div style={s.previewList}>
                  {overview.preview_cards.map((card, index) => (
                    <div key={card.id} className="surface" style={s.previewCard}>
                      <div style={s.previewMeta}>Card {index + 1} · {cardTypeLabel(card.type, "short")}</div>
                      <div style={s.previewFront}>
                        <CardContentRenderer
                          content={card.type === "cloze" ? card.cloze_text : card.front}
                          clozeMode={card.type === "cloze" ? "revealed" : "none"}
                        />
                      </div>
                      <div style={s.previewBack}>
                        {truncate(cardAnswerText(card)) || "—"}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </aside>
          </div>

          {error ? <div className="notice notice-error">{error}</div> : null}

          <div style={s.footer}>
            <Link href={`/decks?deck=${overview.id}`} className="btn btn-ghost btn-sm" onClick={onClose}>
              <i className="ri-table-line" />
              Browse cards
            </Link>
            <Link href={`/decks/${overview.id}`} className="btn btn-secondary btn-sm" onClick={onClose}>
              <i className="ri-folder-open-line" />
              Open deck
            </Link>
            <Link href={`/decks/new?deck=${overview.id}`} className="btn btn-ghost btn-sm" onClick={onClose}>
              <i className="ri-add-line" />
              Create cards
            </Link>
            {canStudy ? (
              <Link href={`/decks/${overview.id}/study`} className="btn btn-primary btn-sm" onClick={onClose}>
                <i className="ri-book-open-line" />
                Study
              </Link>
            ) : (
              <button type="button" className="btn btn-secondary btn-sm" disabled>
                Caught up
              </button>
            )}
          </div>
        </div>
      ) : null}
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  body: { display: "flex", flexDirection: "column", gap: 20 },
  centered: { padding: "40px 0", textAlign: "center" },
  statsRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  columns: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(220px, 280px)",
    gap: 20,
    alignItems: "start",
  },
  mainCol: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 },
  previewCol: { minWidth: 0 },
  section: { display: "flex", flexDirection: "column", gap: 8 },
  sectionHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  sectionTitle: {
    margin: 0,
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  sectionHint: {
    margin: 0,
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  settingsGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  rangeLabel: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  previewList: { display: "flex", flexDirection: "column", gap: 10, maxHeight: 360, overflow: "auto" },
  previewCard: { padding: 12, display: "flex", flexDirection: "column", gap: 8 },
  previewMeta: {
    font: "500 11px/16px var(--font-sans)",
    color: "var(--fg-4)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  previewFront: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  previewBack: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-3)",
  },
  previewEmpty: {
    padding: 24,
    textAlign: "center",
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
    border: "1px dashed var(--border-2)",
    borderRadius: 12,
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    paddingTop: 4,
    borderTop: "1px solid var(--border-1)",
  },
};
