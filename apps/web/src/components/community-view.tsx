"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { CardContent } from "@/components/card-content";
import { FadeIn } from "@/components/motion/fade-in";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";
import type { CommunityDeckRow, PublicationCard, SyncMode } from "@/lib/community/types";

type PreviewState = {
  deck: CommunityDeckRow;
  cards: PublicationCard[];
  loading: boolean;
};

function cardFrontContent(card: PublicationCard): string | null {
  if (card.type === "cloze" && card.cloze_text) return card.cloze_text;
  return card.front;
}

function cardAnswerContent(card: PublicationCard): string | null {
  if (card.type === "basic" && card.back) return card.back;
  if (card.extra) return card.extra;
  return null;
}

export function CommunityView({ initialDecks }: { initialDecks: CommunityDeckRow[] }) {
  const router = useRouter();
  const [decks, setDecks] = useState(initialDecks);
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [subscribeTarget, setSubscribeTarget] = useState<CommunityDeckRow | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>("follow");

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return decks;
    return decks.filter((d) => d.title.toLowerCase().includes(needle));
  }, [decks, q]);

  async function openPreview(deck: CommunityDeckRow) {
    setError(null);
    setPreview({ deck, cards: [], loading: true });
    try {
      const res = await fetch(`/api/community/decks/${deck.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setPreview({
        deck: { ...deck, is_subscribed: data.is_subscribed, subscription_sync_mode: data.subscription_sync_mode },
        cards: data.previewCards ?? [],
        loading: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load preview");
      setPreview(null);
    }
  }

  async function subscribe(deck: CommunityDeckRow, mode: SyncMode) {
    setBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(`/api/community/decks/${deck.id}/subscribe`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sync_mode: mode }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Subscribe failed");
      }
      const data = await res.json();
      setDecks((prev) =>
        prev.map((d) =>
          d.id === deck.id
            ? {
                ...d,
                is_subscribed: true,
                subscription_sync_mode: mode,
                subscriber_count: d.subscriber_count + 1,
              }
            : d,
        ),
      );
      setSubscribeTarget(null);
      setPreview(null);
      router.push(`/decks/${data.localProjectId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Subscribe failed");
    } finally {
      setBusyId(null);
    }
  }

  async function unsubscribe(deck: CommunityDeckRow) {
    if (!confirm(`Unsubscribe from "${deck.title}"? Your local copy will remain in Browse.`)) return;
    setBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(`/api/community/decks/${deck.id}/subscribe`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Unsubscribe failed");
      }
      setDecks((prev) =>
        prev.map((d) =>
          d.id === deck.id
            ? {
                ...d,
                is_subscribed: false,
                subscription_sync_mode: null,
                subscriber_count: Math.max(0, d.subscriber_count - 1),
              }
            : d,
        ),
      );
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unsubscribe failed");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <div style={s.searchWrap}>
        <i className="ri-search-line" style={{ color: "var(--ink-400)" }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search decks"
          style={s.searchInput}
        />
      </div>

      <AnimatePresence>
        {error && (
          <m.div
            style={s.errorBanner}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
          >
            <i className="ri-error-warning-line" />
            {error}
          </m.div>
        )}
      </AnimatePresence>

      {filtered.length === 0 ? (
        <FadeIn>
          <div style={s.empty}>
            <i className="ri-community-line" style={{ fontSize: 40, color: "var(--ink-200)" }} />
            <div style={{ font: "500 16px/24px var(--font-sans)", color: "var(--ink-700)" }}>
              {decks.length === 0 ? "No community decks yet" : "No decks match your search"}
            </div>
            <div style={{ font: "400 14px/20px var(--font-sans)", color: "var(--fg-4)" }}>
              Publish one of your decks from Browse, or check back later.
            </div>
          </div>
        </FadeIn>
      ) : (
        <StaggerList style={s.grid}>
          {filtered.map((deck) => (
            <StaggerItem key={deck.id} as="div">
              <m.article
                style={s.card}
                whileHover={{ y: -2, boxShadow: "var(--shadow-sm)" }}
                transition={{ duration: 0.18 }}
              >
              <button type="button" style={s.cardTitleBtn} onClick={() => openPreview(deck)}>
                <i className="ri-book-2-line" style={{ color: "var(--ink-400)" }} />
                <span>{deck.title}</span>
              </button>

              <div style={s.badges}>
                <span className="chip chip-new">
                  <i className="ri-stack-line" style={{ marginRight: 4 }} />
                  {deck.card_count} CARDS
                </span>
                <span className="chip chip-due">
                  <i className="ri-group-line" style={{ marginRight: 4 }} />
                  {deck.subscriber_count} SUBSCRIBERS
                </span>
              </div>

              <div style={s.cardActions}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => openPreview(deck)}
                  disabled={busyId === deck.id}
                >
                  Preview
                </button>
                {deck.is_owner ? (
                  <span style={s.ownerLabel}>Your deck</span>
                ) : deck.is_subscribed ? (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => unsubscribe(deck)}
                    disabled={busyId === deck.id}
                  >
                    <i className="ri-subtract-line" />
                    Unsubscribe
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setSyncMode("follow");
                      setSubscribeTarget(deck);
                    }}
                    disabled={busyId === deck.id}
                  >
                    <i className="ri-add-line" />
                    Subscribe
                  </button>
                )}
              </div>
              </m.article>
            </StaggerItem>
          ))}
        </StaggerList>
      )}

      {preview && (
        <AnimatedModal title={preview.deck.title} onClose={() => setPreview(null)}>
          {preview.loading ? (
            <p style={s.muted}>Loading preview…</p>
          ) : (
            <>
              {preview.deck.description && (
                <p style={{ ...s.muted, marginBottom: 16 }}>{preview.deck.description}</p>
              )}
              <div style={s.previewMeta}>
                <span className="chip chip-new">{preview.deck.card_count} cards</span>
                <span className="chip chip-due">{preview.deck.subscriber_count} subscribers</span>
                {preview.deck.is_subscribed && preview.deck.subscription_sync_mode && (
                  <span className="chip chip-neutral">
                    {preview.deck.subscription_sync_mode === "follow" ? "Following updates" : "Personal copy"}
                  </span>
                )}
              </div>
              <StaggerList style={s.previewList}>
                {preview.cards.map((card, i) => (
                  <StaggerItem key={i} style={s.previewItem}>
                    <CardContent text={cardFrontContent(card)} style={s.previewFront} />
                    {cardAnswerContent(card) && (
                      <CardContent text={cardAnswerContent(card)} style={s.previewBack} />
                    )}
                  </StaggerItem>
                ))}
              </StaggerList>
              {preview.deck.card_count > preview.cards.length && (
                <p style={{ ...s.muted, marginTop: 12, fontSize: 12 }}>
                  Showing {preview.cards.length} of {preview.deck.card_count} cards
                </p>
              )}
              <div style={s.modalActions}>
                {!preview.deck.is_owner && !preview.deck.is_subscribed && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      setSyncMode("follow");
                      setSubscribeTarget(preview.deck);
                    }}
                  >
                    Subscribe
                  </button>
                )}
                {preview.deck.is_subscribed && !preview.deck.is_owner && (
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => unsubscribe(preview.deck)}
                    disabled={busyId === preview.deck.id}
                  >
                    Unsubscribe
                  </button>
                )}
              </div>
            </>
          )}
        </AnimatedModal>
      )}

      {subscribeTarget && (
        <AnimatedModal title={`Subscribe to ${subscribeTarget.title}`} onClose={() => setSubscribeTarget(null)}>
          <p style={{ ...s.muted, marginBottom: 16 }}>
            Choose how you want this deck in your library:
          </p>
          <div style={s.syncOptions}>
            <label style={syncMode === "follow" ? s.syncOptionActive : s.syncOption}>
              <input
                type="radio"
                name="sync_mode"
                checked={syncMode === "follow"}
                onChange={() => setSyncMode("follow")}
              />
              <div>
                <strong style={s.syncTitle}>Follow updates</strong>
                <p style={s.syncDesc}>
                  Stay synced when the creator republishes. Your study progress is kept, but card
                  content may change on updates.
                </p>
              </div>
            </label>
            <label style={syncMode === "fork" ? s.syncOptionActive : s.syncOption}>
              <input
                type="radio"
                name="sync_mode"
                checked={syncMode === "fork"}
                onChange={() => setSyncMode("fork")}
              />
              <div>
                <strong style={s.syncTitle}>Make a personal copy</strong>
                <p style={s.syncDesc}>
                  Get a snapshot you can edit freely. You won&apos;t receive future updates from the
                  creator.
                </p>
              </div>
            </label>
          </div>
          <div style={s.modalActions}>
            <button type="button" className="btn btn-ghost" onClick={() => setSubscribeTarget(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busyId === subscribeTarget.id}
              onClick={() => subscribe(subscribeTarget, syncMode)}
            >
              {busyId === subscribeTarget.id ? "Subscribing…" : "Subscribe"}
            </button>
          </div>
        </AnimatedModal>
      )}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  searchWrap: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    border: "1px solid var(--border-1)",
    borderRadius: 8,
    background: "var(--white)",
  },
  searchInput: {
    flex: 1,
    border: 0,
    outline: 0,
    background: "transparent",
    font: "400 14px/20px var(--font-sans)",
    color: "var(--ink-700)",
  },
  errorBanner: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    background: "var(--orange-50)",
    color: "var(--orange-700)",
    font: "400 14px/20px var(--font-sans)",
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "80px 24px",
    gap: 8,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    textAlign: "center",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 16,
  },
  card: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 140,
  },
  cardTitleBtn: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    border: 0,
    background: "transparent",
    padding: 0,
    textAlign: "left",
    cursor: "pointer",
    font: "600 15px/22px var(--font-sans)",
    color: "var(--ink-900)",
  },
  badges: { display: "flex", flexWrap: "wrap", gap: 8 },
  cardActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto",
    gap: 8,
  },
  ownerLabel: {
    font: "500 12px/1 var(--font-sans)",
    color: "var(--fg-4)",
    textTransform: "uppercase",
    letterSpacing: ".04em",
  },
  muted: { font: "400 14px/20px var(--font-sans)", color: "var(--fg-3)", margin: 0 },
  previewMeta: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  previewList: { display: "flex", flexDirection: "column", gap: 10 },
  previewItem: {
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
  },
  previewFront: { font: "500 14px/20px var(--font-sans)", color: "var(--ink-900)" },
  previewBack: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-3)",
    marginTop: 6,
  },
  modalActions: {
    display: "flex",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 20,
  },
  syncOptions: { display: "flex", flexDirection: "column", gap: 10 },
  syncOption: {
    display: "flex",
    gap: 12,
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--border-1)",
    cursor: "pointer",
  },
  syncOptionActive: {
    display: "flex",
    gap: 12,
    padding: 14,
    borderRadius: 10,
    border: "1px solid var(--teal-500)",
    background: "var(--paper-soft)",
    cursor: "pointer",
  },
  syncTitle: { font: "500 14px/20px var(--font-sans)", color: "var(--ink-900)" },
  syncDesc: { font: "400 13px/18px var(--font-sans)", color: "var(--fg-3)", margin: "4px 0 0" },
};
