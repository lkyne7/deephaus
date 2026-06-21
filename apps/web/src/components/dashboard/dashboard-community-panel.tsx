"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { m } from "motion/react";
import { CommunitySectionSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { pickDashboardCommunityDecks } from "@/lib/community/load-community-decks";
import type { CommunityDeckRow } from "@/lib/community/types";

const LIMIT = 4;

export function DashboardCommunityPanel() {
  const router = useRouter();
  const [decks, setDecks] = useState<CommunityDeckRow[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/community/decks", { credentials: "include" });
        if (!res.ok) throw new Error("Failed to load community decks");
        const rows = (await res.json()) as CommunityDeckRow[];
        if (!cancelled) setDecks(rows);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
          setDecks([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const subscribe = useCallback(
    async (deck: CommunityDeckRow) => {
      setBusyId(deck.id);
      setError(null);
      try {
        const res = await fetch(`/api/community/decks/${deck.id}/subscribe`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sync_mode: "follow" }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? "Subscribe failed");
        }
        const data = (await res.json()) as { localProjectId: string };
        router.push(`/decks/${data.localProjectId}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Subscribe failed");
      } finally {
        setBusyId(null);
      }
    },
    [router],
  );

  if (decks === null) {
    return <CommunitySectionSkeleton />;
  }

  const picks = pickDashboardCommunityDecks(decks, LIMIT);
  const discoverable = decks.filter((d) => !d.is_owner);

  if (discoverable.length === 0) {
    return null;
  }

  return (
    <section>
      <DashboardSectionHeader
        title="From the community"
        icon="ri-earth-line"
        count={discoverable.length}
        action={{ kind: "link", href: "/community", label: "Browse all" }}
      />

      {error ? (
        <p style={s.error} role="alert">
          <i className="ri-error-warning-line" /> {error}
        </p>
      ) : null}

      {picks.length === 0 ? (
        <div style={s.empty}>
          <p style={s.emptyText}>Published decks from other learners will show up here.</p>
          <Link href="/community" className="btn btn-secondary btn-sm">
            Explore community
          </Link>
        </div>
      ) : (
        <div style={s.row}>
          {picks.map((deck) => (
            <m.article
              key={deck.id}
              style={s.card}
              whileHover={{ borderColor: "var(--border-primary)" }}
              transition={{ duration: 0.15 }}
            >
              <div style={s.cardTop}>
                <i className="ri-book-open-line" style={s.cardIcon} aria-hidden />
                <h3 style={s.cardTitle}>{deck.title}</h3>
              </div>

              {deck.description ? (
                <p style={s.cardDesc}>
                  {deck.description.length > 72
                    ? `${deck.description.slice(0, 72)}…`
                    : deck.description}
                </p>
              ) : null}

              <div style={s.badges}>
                <span className="chip chip-neutral">
                  <i className="ri-stack-line" style={{ marginRight: 4 }} />
                  {deck.card_count}
                </span>
                <span className="chip chip-neutral">
                  <i className="ri-group-line" style={{ marginRight: 4 }} />
                  {deck.subscriber_count}
                </span>
              </div>

              <div style={s.cardActions}>
                <Link href="/community" className="btn btn-ghost btn-sm">
                  Preview
                </Link>
                {deck.is_subscribed && deck.local_project_id ? (
                  <Link href={`/decks/${deck.local_project_id}`} className="btn btn-primary btn-sm">
                    Open
                  </Link>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={busyId === deck.id}
                    onClick={() => void subscribe(deck)}
                  >
                    {busyId === deck.id ? "Adding…" : "Subscribe"}
                  </button>
                )}
              </div>
            </m.article>
          ))}
        </div>
      )}
    </section>
  );
}

const s: Record<string, React.CSSProperties> = {
  error: {
    margin: "0 0 12px",
    font: "400 13px/18px var(--font-sans)",
    color: "var(--orange-700)",
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
    padding: "20px 24px",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
  },
  emptyText: {
    margin: 0,
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  row: {
    display: "grid",
    gridTemplateColumns: `repeat(${LIMIT}, minmax(200px, 1fr))`,
    gap: 16,
    overflowX: "auto",
    paddingBottom: 4,
  },
  card: {
    background: "var(--white)",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "var(--border-2)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    minHeight: 168,
  },
  cardTop: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    minWidth: 0,
  },
  cardIcon: {
    fontSize: 18,
    color: "var(--teal-500)",
    flexShrink: 0,
    marginTop: 2,
  },
  cardTitle: {
    margin: 0,
    font: "600 15px/22px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
  },
  cardDesc: {
    margin: 0,
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
  badges: { display: "flex", flexWrap: "wrap", gap: 8 },
  cardActions: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: "auto",
  },
};
