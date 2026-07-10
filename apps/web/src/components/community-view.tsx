"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, m } from "motion/react";
import { useRouter } from "next/navigation";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { CardContentRenderer } from "@/components/rich-text/card-content-renderer";
import { FadeIn } from "@/components/motion/fade-in";
import { cardTypeLabel } from "@deephaus/shared";
import "@/components/rich-text/rich-text.css";
import { StaggerItem, StaggerList } from "@/components/motion/stagger-list";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { UntitledSearchInput } from "@/components/ui/untitled-controls";
import { PreviewCardsSkeleton } from "@/components/ui/skeleton-patterns";
import { pickFeaturedDecks } from "@/lib/community/load-community-decks";
import type { CommunityDeckRow, PublicationCard, SyncMode } from "@/lib/community/types";

const FEATURED_COUNT = 3;

type ViewMode = "table" | "grid";

type PreviewState = {
  deck: CommunityDeckRow;
  cards: PublicationCard[];
  loading: boolean;
};

function publicationCardFront(card: PublicationCard): string | null {
  if (card.type === "cloze") return card.cloze_text;
  return card.front;
}

function publicationCardAnswer(card: PublicationCard): string | null {
  if (card.type === "basic") return card.back ?? card.extra;
  return card.extra;
}

export function CommunityView({
  initialDecks,
  initialQuery = "",
}: {
  initialDecks: CommunityDeckRow[];
  initialQuery?: string;
}) {
  const router = useRouter();
  const [decks, setDecks] = useState(initialDecks);
  const [q, setQ] = useState(initialQuery);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [subscribeTarget, setSubscribeTarget] = useState<CommunityDeckRow | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>("follow");
  const [view, setView] = useState<ViewMode>("table");

  useEffect(() => {
    setQ(initialQuery);
  }, [initialQuery]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return decks;
    return decks.filter((d) => d.title.toLowerCase().includes(needle));
  }, [decks, q]);

  const featured = useMemo(() => pickFeaturedDecks(decks, FEATURED_COUNT), [decks]);
  const featuredIds = useMemo(() => new Set(featured.map((d) => d.id)), [featured]);
  // Spotlight only when browsing (not searching) and there's a real catalog
  // beyond the featured picks, so it doesn't just mirror the full list.
  const showFeatured = q.trim() === "" && featured.length > 0 && decks.length > FEATURED_COUNT;

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
                local_project_id: data.localProjectId,
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
    if (!confirm(`Unsubscribe from "${deck.title}"? Your local copy will remain in Cards.`)) return;
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

  const renderDeckActions = (deck: CommunityDeckRow) => (
    <div style={s.rowActions}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={(e) => {
          e.stopPropagation();
          void openPreview(deck);
        }}
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
          onClick={(e) => {
            e.stopPropagation();
            void unsubscribe(deck);
          }}
          disabled={busyId === deck.id}
        >
          Unsubscribe
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={(e) => {
            e.stopPropagation();
            setSyncMode("follow");
            setSubscribeTarget(deck);
          }}
          disabled={busyId === deck.id}
        >
          Subscribe
        </button>
      )}
    </div>
  );

  const renderDeckTableRow = (deck: CommunityDeckRow) => (
    <tr
      key={deck.id}
      style={s.tr}
      className="dh-deck-table-row"
      onClick={() => openPreview(deck)}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") openPreview(deck);
      }}
    >
      <td style={s.td}>
        <div style={s.nameCell}>
          <span style={s.deckIcon}>
            <i className="ri-earth-line" aria-hidden />
          </span>
          <span style={{ minWidth: 0 }}>
            <span style={s.deckName}>{deck.title}</span>
            <span style={s.deckSub}>
              {deck.card_count.toLocaleString()} cards
              {featuredIds.has(deck.id) ? <span style={s.featuredTag}>· Featured</span> : null}
            </span>
          </span>
        </div>
      </td>
      <td style={s.td}>
        <span className="chip chip-neutral">{deck.card_count.toLocaleString()}</span>
      </td>
      <td style={s.td}>
        <span style={s.subscriberCount}>{deck.subscriber_count.toLocaleString()}</span>
      </td>
      <td style={{ ...s.td, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
        {renderDeckActions(deck)}
      </td>
    </tr>
  );

  const renderDeckCard = (deck: CommunityDeckRow, isFeatured = false) => (
    <article
      className={isFeatured ? "dh-lift-card is-featured" : "dh-lift-card"}
      style={s.card}
    >
      <button type="button" style={s.cardTitleBtn} onClick={() => openPreview(deck)}>
        <i className="ri-book-2-line" style={{ color: "var(--ink-400)" }} />
        <span>{deck.title}</span>
      </button>

      <div style={s.badges}>
        {isFeatured && (
          <span className="chip chip-new">
            <i className="ri-star-line" style={{ marginRight: 4 }} />
            Featured
          </span>
        )}
        <span className="chip chip-neutral">
          <i className="ri-stack-line" style={{ marginRight: 4 }} />
          {deck.card_count} cards
        </span>
        <span className="chip chip-neutral">
          <i className="ri-group-line" style={{ marginRight: 4 }} />
          {deck.subscriber_count} subscribers
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
    </article>
  );

  return (
    <>
      <section>
        <DashboardSectionHeader
          title="Community"
          rightAction={
            <div style={s.toolbar}>
              <UntitledSearchInput
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search community decks..."
                aria-label="Search community decks"
                wrapperStyle={s.search}
              />
              <div className="dh-view-toggle" role="group" aria-label="Community deck view">
                <ViewButton
                  active={view === "table"}
                  icon="ri-list-check"
                  label="List view"
                  onClick={() => setView("table")}
                />
                <ViewButton
                  active={view === "grid"}
                  icon="ri-layout-grid-line"
                  label="Grid view"
                  onClick={() => setView("grid")}
                />
              </div>
            </div>
          }
        />

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
              Publish one of your decks from Cards, or check back later.
            </div>
          </div>
        </FadeIn>
      ) : view === "table" ? (
        <div style={s.tableCard}>
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Deck name</th>
                <th style={{ ...s.th, width: 88 }}>Cards</th>
                <th style={{ ...s.th, width: 120 }}>Subscribers</th>
                <th style={{ ...s.th, width: 220 }} aria-hidden />
              </tr>
            </thead>
            <tbody>{filtered.map((deck) => renderDeckTableRow(deck))}</tbody>
          </table>
        </div>
      ) : (
        <>
          {showFeatured && (
            <FadeIn>
              <section style={s.section}>
                <div style={s.sectionHead}>
                  <i className="ri-star-line" style={{ color: "var(--teal-500)" }} />
                  <h2 style={s.sectionTitle}>Featured decks</h2>
                </div>
                <StaggerList style={s.grid}>
                  {featured.map((deck) => (
                    <StaggerItem key={`featured-${deck.id}`} as="div">
                      {renderDeckCard(deck, true)}
                    </StaggerItem>
                  ))}
                </StaggerList>
              </section>
            </FadeIn>
          )}

          <section style={s.section}>
            {showFeatured && (
              <div style={s.sectionHead}>
                <i className="ri-book-2-line" style={{ color: "var(--ink-400)" }} />
                <h2 style={s.sectionTitle}>All decks</h2>
              </div>
            )}
            <StaggerList style={s.grid}>
              {filtered.map((deck) => (
                <StaggerItem key={deck.id} as="div">
                  {renderDeckCard(deck)}
                </StaggerItem>
              ))}
            </StaggerList>
          </section>
        </>
      )}
      </section>

      {preview && (
        <AnimatedModal title={preview.deck.title} onClose={() => setPreview(null)}>
          {preview.loading ? (
            <PreviewCardsSkeleton count={4} />
          ) : (
            <>
              {preview.deck.description && (
                <p style={{ ...s.muted, marginBottom: 16 }}>{preview.deck.description}</p>
              )}
              <div style={s.previewMeta}>
                <span className="chip chip-neutral">{preview.deck.card_count} cards</span>
                <span className="chip chip-neutral">{preview.deck.subscriber_count} subscribers</span>
                {preview.deck.is_subscribed && preview.deck.subscription_sync_mode && (
                  <span className="chip chip-neutral">
                    {preview.deck.subscription_sync_mode === "follow" ? "Following updates" : "Personal copy"}
                  </span>
                )}
              </div>
              <StaggerList style={s.previewList}>
                {preview.cards.map((card, i) => {
                  const front = publicationCardFront(card);
                  const answer = publicationCardAnswer(card);
                  return (
                    <StaggerItem key={card.id ?? i} style={s.previewItem}>
                      <div style={s.previewCardMeta}>
                        Card {i + 1} · {cardTypeLabel(card.type, "short")}
                      </div>
                      <div style={s.previewFront}>
                        {front?.trim() ? (
                          <CardContentRenderer
                            content={front}
                            clozeMode={card.type === "cloze" ? "revealed" : "none"}
                          />
                        ) : (
                          "—"
                        )}
                      </div>
                      {answer?.trim() ? (
                        <div style={s.previewBack}>
                          <CardContentRenderer content={answer} />
                        </div>
                      ) : null}
                    </StaggerItem>
                  );
                })}
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

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dh-view-toggle-btn"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      <i className={icon} aria-hidden />
    </button>
  );
}

const s: Record<string, React.CSSProperties> = {
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "nowrap",
    flexShrink: 0,
  },
  search: {
    width: 260,
    maxWidth: "100%",
  },
  tableCard: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    tableLayout: "fixed",
    font: "400 13px/18px var(--font-sans)",
  },
  th: {
    textAlign: "left",
    padding: "10px 16px",
    background: "var(--paper-soft)",
    borderBottom: "1px solid var(--border-1)",
    font: "500 12px/1 var(--font-sans)",
    color: "var(--fg-4)",
  },
  tr: {
    cursor: "pointer",
    borderBottom: "1px solid var(--border-1)",
    outline: "none",
  },
  td: {
    padding: "12px 16px",
    verticalAlign: "middle",
    color: "var(--ink-700)",
  },
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  deckIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    background: "color-mix(in srgb, #7c5cfc 15%, transparent)",
    color: "#7c5cfc",
    fontSize: 16,
  },
  deckName: {
    display: "block",
    font: "500 14px/18px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  deckSub: {
    display: "block",
    marginTop: 2,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  featuredTag: {
    marginLeft: 6,
    color: "var(--teal-700)",
    fontWeight: 500,
  },
  subscriberCount: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  rowActions: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    flexWrap: "wrap",
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
    borderRadius: 8,
    textAlign: "center",
  },
  section: { display: "flex", flexDirection: "column", gap: 12 },
  sectionHead: { display: "flex", alignItems: "center", gap: 8 },
  sectionTitle: {
    margin: 0,
    font: "600 16px/24px var(--font-sans)",
    color: "var(--ink-900)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
    gap: 16,
  },
  card: {
    background: "var(--white)",
    borderRadius: 8,
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
  },
  muted: { font: "400 14px/20px var(--font-sans)", color: "var(--fg-3)", margin: 0 },
  previewMeta: { display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 },
  previewList: { display: "flex", flexDirection: "column", gap: 10 },
  previewItem: {
    padding: 12,
    borderRadius: 8,
    border: "1px solid var(--border-1)",
    background: "var(--paper-soft)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  previewCardMeta: {
    font: "500 11px/16px var(--font-sans)",
    color: "var(--fg-4)",
    letterSpacing: "0.01em",
  },
  previewFront: {
    font: "500 13px/18px var(--font-sans)",
    color: "var(--ink-900)",
  },
  previewBack: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-3)",
    paddingTop: 8,
    borderTop: "1px solid var(--border-1)",
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
    borderRadius: 8,
    border: "1px solid var(--border-1)",
    cursor: "pointer",
  },
  syncOptionActive: {
    display: "flex",
    gap: 12,
    padding: 14,
    borderRadius: 8,
    border: "1px solid var(--teal-500)",
    background: "var(--paper-soft)",
    cursor: "pointer",
  },
  syncTitle: { font: "500 14px/20px var(--font-sans)", color: "var(--ink-900)" },
  syncDesc: { font: "400 13px/18px var(--font-sans)", color: "var(--fg-3)", margin: "4px 0 0" },
};
