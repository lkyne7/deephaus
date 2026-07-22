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
import { DeckOverviewSkeleton } from "@/components/ui/skeleton-patterns";
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

type DeckRelation = "owned" | "subscribed" | "community";

function deckRelation(deck: CommunityDeckRow): DeckRelation {
  if (deck.is_owner) return "owned";
  if (deck.is_subscribed) return "subscribed";
  return "community";
}

function deckRelationMeta(relation: DeckRelation): {
  icon: string;
  color: string;
  label: string;
  chipStyle: React.CSSProperties;
} {
  if (relation === "owned") {
    return {
      icon: "ri-share-forward-line",
      color: "#3b82f6",
      label: "Your deck",
      chipStyle: {
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        font: "500 12px/16px var(--font-sans)",
        background: "color-mix(in srgb, #3b82f6 15%, transparent)",
        color: "#3b82f6",
      },
    };
  }
  if (relation === "subscribed") {
    return {
      icon: "ri-bookmark-3-line",
      color: "var(--teal-700)",
      label: "Subscribed",
      chipStyle: {
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 999,
        font: "500 12px/16px var(--font-sans)",
        background: "color-mix(in srgb, var(--teal-500) 15%, transparent)",
        color: "var(--teal-700)",
      },
    };
  }
  return {
    icon: "ri-earth-line",
    color: "#7c5cfc",
    label: "Community",
    chipStyle: {
      display: "inline-flex",
      alignItems: "center",
      padding: "2px 8px",
      borderRadius: 999,
      font: "500 12px/16px var(--font-sans)",
      background: "color-mix(in srgb, #7c5cfc 15%, transparent)",
      color: "#7c5cfc",
    },
  };
}

function formatRating(avg: number, count: number): string {
  if (count <= 0) return "No ratings";
  return `${avg.toFixed(1)} (${count})`;
}

function StarRating({
  value,
  onChange,
  disabled = false,
  size = 18,
}: {
  value: number | null;
  onChange?: (stars: number) => void;
  disabled?: boolean;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const display = hover ?? value ?? 0;
  const interactive = Boolean(onChange) && !disabled;

  return (
    <div
      style={{ display: "inline-flex", alignItems: "center", gap: 2 }}
      onMouseLeave={() => setHover(null)}
      role={interactive ? "radiogroup" : "img"}
      aria-label={value ? `Rated ${value} of 5 stars` : "Not rated"}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const filled = star <= display;
        return (
          <button
            key={star}
            type="button"
            disabled={!interactive}
            aria-label={`${star} star${star === 1 ? "" : "s"}`}
            aria-checked={value === star}
            role={interactive ? "radio" : undefined}
            onMouseEnter={() => {
              if (interactive) setHover(star);
            }}
            onFocus={() => {
              if (interactive) setHover(star);
            }}
            onBlur={() => setHover(null)}
            onClick={() => onChange?.(star)}
            style={{
              border: 0,
              background: "transparent",
              padding: 0,
              cursor: interactive ? "pointer" : "default",
              color: filled ? "var(--teal-500)" : "var(--ink-200)",
              fontSize: size,
              lineHeight: 1,
              display: "inline-flex",
            }}
          >
            <i className={filled ? "ri-star-fill" : "ri-star-line"} aria-hidden />
          </button>
        );
      })}
    </div>
  );
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
  const [ratingBusyId, setRatingBusyId] = useState<string | null>(null);
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

  function applyRatingUpdate(
    deckId: string,
    next: { my_rating: number | null; avg_rating: number; rating_count: number },
  ) {
    setDecks((prev) =>
      prev.map((d) =>
        d.id === deckId
          ? {
              ...d,
              my_rating: next.my_rating,
              avg_rating: next.avg_rating,
              rating_count: next.rating_count,
            }
          : d,
      ),
    );
    setPreview((prev) =>
      prev && prev.deck.id === deckId
        ? {
            ...prev,
            deck: {
              ...prev.deck,
              my_rating: next.my_rating,
              avg_rating: next.avg_rating,
              rating_count: next.rating_count,
            },
          }
        : prev,
    );
  }

  async function openPreview(deck: CommunityDeckRow) {
    setError(null);
    setPreview({ deck, cards: [], loading: true });
    try {
      const res = await fetch(`/api/community/decks/${deck.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      const publication = data.publication ?? {};
      setPreview({
        deck: {
          ...deck,
          ...publication,
          is_subscribed: data.is_subscribed,
          subscription_sync_mode: data.subscription_sync_mode,
          local_project_id: data.local_project_id ?? deck.local_project_id,
          my_rating: data.my_rating ?? null,
          avg_rating: Number(publication.avg_rating ?? deck.avg_rating ?? 0),
          rating_count: Number(publication.rating_count ?? deck.rating_count ?? 0),
        },
        cards: data.previewCards ?? [],
        loading: false,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load preview");
      setPreview(null);
    }
  }

  async function rateDeck(deck: CommunityDeckRow, stars: number) {
    if (deck.is_owner) return;
    setRatingBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(`/api/community/decks/${deck.id}/rating`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not save rating");
      }
      const data = await res.json();
      applyRatingUpdate(deck.id, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save rating");
    } finally {
      setRatingBusyId(null);
    }
  }

  async function clearRating(deck: CommunityDeckRow) {
    if (deck.is_owner || deck.my_rating == null) return;
    setRatingBusyId(deck.id);
    setError(null);
    try {
      const res = await fetch(`/api/community/decks/${deck.id}/rating`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not clear rating");
      }
      const data = await res.json();
      applyRatingUpdate(deck.id, data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear rating");
    } finally {
      setRatingBusyId(null);
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

  const renderDeckActions = (deck: CommunityDeckRow) => {
    const relation = deckRelation(deck);
    return (
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
        {relation === "owned" ? (
          <span style={s.actionSpacer} aria-hidden />
        ) : relation === "subscribed" ? (
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
  };

  const renderDeckTableRow = (deck: CommunityDeckRow) => {
    const relation = deckRelation(deck);
    const meta = deckRelationMeta(relation);
    return (
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
            <span
              style={{
                ...s.iconBox,
                background: `color-mix(in srgb, ${meta.color} 15%, transparent)`,
                color: meta.color,
              }}
              title={meta.label}
              aria-label={meta.label}
            >
              <i className={meta.icon} aria-hidden />
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={s.deckName}>{deck.title}</span>
              <span style={s.deckSub}>
                {deck.card_count.toLocaleString()} cards
                <span style={{ marginLeft: 6, color: meta.color, fontWeight: 500 }}>
                  · {meta.label}
                </span>
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
        <td style={s.td}>
          <span style={s.ratingCell}>
            <i className="ri-star-fill" style={{ color: "var(--teal-500)", fontSize: 13 }} aria-hidden />
            {formatRating(deck.avg_rating ?? 0, deck.rating_count ?? 0)}
          </span>
        </td>
        <td style={{ ...s.td, textAlign: "right" }} onClick={(e) => e.stopPropagation()}>
          {renderDeckActions(deck)}
        </td>
      </tr>
    );
  };

  const renderDeckCard = (deck: CommunityDeckRow, isFeatured = false) => {
    const relation = deckRelation(deck);
    const meta = deckRelationMeta(relation);
    return (
      <article
        className={isFeatured ? "dh-deck-grid-card is-featured" : "dh-deck-grid-card"}
        style={s.card}
        role="link"
        tabIndex={0}
        title={deck.title}
        onClick={() => openPreview(deck)}
        onKeyDown={(e) => {
          if (e.key === "Enter") openPreview(deck);
        }}
      >
        <div style={s.cardTitleLink}>
          <i className={meta.icon} style={{ color: meta.color, flexShrink: 0 }} aria-hidden />
          <span style={s.cardTitleText}>{deck.title}</span>
        </div>

        <div style={s.badges}>
          <span className="chip chip-neutral">
            <i className="ri-stack-line" style={{ marginRight: 4 }} />
            {deck.card_count.toLocaleString()} cards
          </span>
          <span className="chip chip-neutral">
            <i className="ri-group-line" style={{ marginRight: 4 }} />
            {deck.subscriber_count.toLocaleString()}{" "}
            {deck.subscriber_count === 1 ? "subscriber" : "subscribers"}
          </span>
          <span className="chip chip-neutral">
            <i className="ri-star-fill" style={{ marginRight: 4, color: "var(--teal-500)" }} />
            {formatRating(deck.avg_rating ?? 0, deck.rating_count ?? 0)}
          </span>
        </div>

        <div style={{ ...s.cardMeta, color: isFeatured ? "var(--teal-700)" : "var(--fg-4)" }}>
          {isFeatured ? (
            <>
              <i className="ri-star-fill" aria-hidden />
              Featured
            </>
          ) : deck.my_rating ? (
            <>
              <i className="ri-star-fill" aria-hidden style={{ color: "var(--teal-500)" }} />
              You rated {deck.my_rating}/5
            </>
          ) : (
            <>
              <i className="ri-star-line" aria-hidden />
              Not rated yet
            </>
          )}
        </div>

        <div style={s.cardActions} onClick={(e) => e.stopPropagation()}>
          <div style={s.cardTags}>
            <span style={meta.chipStyle}>
              <i className={meta.icon} style={{ marginRight: 4 }} aria-hidden />
              {meta.label}
            </span>
          </div>
          {relation === "owned" ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => openPreview(deck)}
              disabled={busyId === deck.id}
            >
              Preview
            </button>
          ) : relation === "subscribed" ? (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => unsubscribe(deck)}
              disabled={busyId === deck.id}
            >
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
              Subscribe
            </button>
          )}
        </div>
      </article>
    );
  };

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
        ) : (
          <div style={s.results}>
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

            {view === "table" ? (
              <section style={s.section}>
                {showFeatured && (
                  <div style={s.sectionHead}>
                    <i className="ri-book-2-line" style={{ color: "var(--ink-400)" }} />
                    <h2 style={s.sectionTitle}>All decks</h2>
                  </div>
                )}
                <div style={s.tableCard}>
                  <table style={s.table}>
                    <thead>
                      <tr>
                        <th style={s.th}>Deck name</th>
                        <th style={{ ...s.th, width: 88 }}>Cards</th>
                        <th style={{ ...s.th, width: 110 }}>Subscribers</th>
                        <th style={{ ...s.th, width: 110 }}>Rating</th>
                        <th style={{ ...s.th, width: 240 }} aria-hidden />
                      </tr>
                    </thead>
                    <tbody>{filtered.map((deck) => renderDeckTableRow(deck))}</tbody>
                  </table>
                </div>
              </section>
            ) : (
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
            )}
          </div>
        )}
      </section>

      {preview && (
        <AnimatedModal
          title={preview.deck.title}
          onClose={() => setPreview(null)}
          maxWidth={760}
        >
          {preview.loading ? (
            <DeckOverviewSkeleton />
          ) : (
            <div style={s.previewBody}>
              <div style={s.statsRow}>
                <span className="chip chip-neutral">
                  <i className="ri-stack-line" style={{ marginRight: 4 }} />
                  {preview.deck.card_count.toLocaleString()} cards
                </span>
                <span className="chip chip-neutral">
                  <i className="ri-group-line" style={{ marginRight: 4 }} />
                  {preview.deck.subscriber_count.toLocaleString()}{" "}
                  {preview.deck.subscriber_count === 1 ? "subscriber" : "subscribers"}
                </span>
                <span className="chip chip-neutral">
                  <i className="ri-star-fill" style={{ marginRight: 4, color: "var(--teal-500)" }} />
                  {formatRating(preview.deck.avg_rating ?? 0, preview.deck.rating_count ?? 0)}
                </span>
                {preview.deck.is_subscribed && preview.deck.subscription_sync_mode && (
                  <span className="chip chip-new">
                    <span className="chip-dot" />
                    {preview.deck.subscription_sync_mode === "follow"
                      ? "Following updates"
                      : "Personal copy"}
                  </span>
                )}
              </div>

              <div style={s.columns}>
                <div style={s.mainCol}>
                  <section style={s.previewSection}>
                    <h3 style={s.previewSectionTitle}>Description</h3>
                    <p style={s.muted}>
                      {preview.deck.description?.trim() || "No description yet."}
                    </p>
                  </section>

                  <section style={s.previewSection}>
                    <h3 style={s.previewSectionTitle}>Your rating</h3>
                    {preview.deck.is_owner ? (
                      <p style={s.sectionHint}>You can&apos;t rate your own deck.</p>
                    ) : (
                      <>
                        <p style={s.sectionHint}>
                          Rate this deck to help others decide what to study.
                        </p>
                        <div style={s.ratingRow}>
                          <StarRating
                            value={preview.deck.my_rating}
                            disabled={ratingBusyId === preview.deck.id}
                            onChange={(stars) => void rateDeck(preview.deck, stars)}
                          />
                          {preview.deck.my_rating != null && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              onClick={() => void clearRating(preview.deck)}
                              disabled={ratingBusyId === preview.deck.id}
                            >
                              Clear
                            </button>
                          )}
                        </div>
                      </>
                    )}
                  </section>
                </div>

                <aside style={s.previewCol}>
                  <h3 style={s.previewSectionTitle}>Preview</h3>
                  {preview.cards.length === 0 ? (
                    <div style={s.previewEmpty}>No cards yet</div>
                  ) : (
                    <div style={s.previewList}>
                      {preview.cards.map((card, i) => {
                        const front = publicationCardFront(card);
                        const answer = publicationCardAnswer(card);
                        return (
                          <div key={card.id ?? i} className="surface" style={s.previewItem}>
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
                            <div style={s.previewBack}>
                              {answer?.trim() ? <CardContentRenderer content={answer} /> : "—"}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {preview.deck.card_count > preview.cards.length && (
                    <p style={{ ...s.muted, fontSize: 12 }}>
                      Showing {preview.cards.length} of {preview.deck.card_count} cards
                    </p>
                  )}
                </aside>
              </div>

              <div style={s.previewFooter}>
                {preview.deck.is_subscribed && preview.deck.local_project_id && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setPreview(null);
                      router.push(`/decks/${preview.deck.local_project_id}`);
                    }}
                  >
                    <i className="ri-folder-open-line" aria-hidden />
                    Open deck
                  </button>
                )}
                {preview.deck.is_subscribed && !preview.deck.is_owner && (
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => unsubscribe(preview.deck)}
                    disabled={busyId === preview.deck.id}
                  >
                    Unsubscribe
                  </button>
                )}
                {!preview.deck.is_owner && !preview.deck.is_subscribed && (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      setSyncMode("follow");
                      setSubscribeTarget(preview.deck);
                    }}
                  >
                    <i className="ri-add-line" aria-hidden />
                    Subscribe
                  </button>
                )}
              </div>
            </div>
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
  iconBox: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
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
  ratingCell: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  rowActions: {
    display: "grid",
    gridTemplateColumns: "auto minmax(7.5rem, auto)",
    alignItems: "center",
    justifyContent: "end",
    gap: 8,
  },
  actionSpacer: {
    display: "block",
    minWidth: "7.5rem",
    height: 1,
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
  results: { display: "flex", flexDirection: "column", gap: 28 },
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
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    minHeight: 168,
    cursor: "pointer",
    outline: "none",
  },
  cardTitleLink: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    color: "var(--ink-900)",
    font: "600 15px/22px var(--font-sans)",
    minWidth: 0,
    overflow: "hidden",
  },
  cardTitleText: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  },
  badges: { display: "flex", flexWrap: "wrap", gap: 8 },
  cardMeta: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
  },
  cardActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    marginTop: "auto",
    gap: 8,
    cursor: "default",
  },
  cardTags: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    marginRight: "auto",
  },
  muted: { font: "400 14px/20px var(--font-sans)", color: "var(--fg-3)", margin: 0 },
  sectionHint: {
    margin: 0,
    font: "400 12px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  previewBody: { display: "flex", flexDirection: "column", gap: 20 },
  statsRow: { display: "flex", flexWrap: "wrap", gap: 8 },
  columns: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
    gap: 20,
    alignItems: "stretch",
  },
  mainCol: { display: "flex", flexDirection: "column", gap: 20, minWidth: 0 },
  previewCol: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    minWidth: 0,
    height: 0,
    minHeight: "100%",
    overflow: "hidden",
  },
  previewSection: { display: "flex", flexDirection: "column", gap: 8 },
  previewSectionTitle: {
    margin: 0,
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  ratingRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  previewList: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    flex: 1,
    minHeight: 0,
    overflow: "auto",
  },
  previewItem: {
    padding: 12,
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
  },
  previewEmpty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
    textAlign: "center",
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
    border: "1px dashed var(--border-2)",
    borderRadius: 8,
  },
  previewFooter: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "flex-end",
    paddingTop: 16,
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
