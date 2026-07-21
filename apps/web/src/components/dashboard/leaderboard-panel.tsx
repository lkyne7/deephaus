"use client";

import { useState } from "react";
import { LeaderboardPanelSkeleton } from "@/components/dashboard/dashboard-skeleton";
import { LeaderboardModal } from "@/components/dashboard/leaderboard-modal";
import { LeaderboardRow } from "@/components/dashboard/leaderboard-row";
import { useLeaderboard } from "@/lib/client-cache/hooks/use-leaderboard";

const PANEL_ROWS = 3;

export function LeaderboardPanel() {
  const [overlayOpen, setOverlayOpen] = useState(false);
  const { data, isLoading } = useLeaderboard("week");

  const modal = (
    <LeaderboardModal open={overlayOpen} onClose={() => setOverlayOpen(false)} />
  );

  if (!data && isLoading) {
    return (
      <div
        style={{ height: "100%", width: "100%", cursor: "pointer" }}
        onClick={() => setOverlayOpen(true)}
      >
        <LeaderboardPanelSkeleton />
        {modal}
      </div>
    );
  }

  const entries = data?.entries.slice(0, PANEL_ROWS) ?? [];
  const me = data?.me ?? null;
  const meVisible = entries.some((entry) => entry.isMe);

  const summary = me
    ? `You're #${me.rank} · ${me.reviews.toLocaleString()} review${me.reviews === 1 ? "" : "s"}`
    : "Review cards to join the ranks";

  return (
    <>
      <div
        className="dh-hero-card"
        style={s.wrap}
        onClick={() => setOverlayOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOverlayOpen(true);
          }
        }}
        role="button"
        tabIndex={0}
        aria-label="Open full leaderboard"
      >
        <div style={s.header}>
          <span style={s.title}>Leaderboard</span>
          <span style={s.periodBadge}>This week</span>
        </div>

        {entries.length > 0 ? (
          <div style={s.rows}>
            {entries.map((entry) => (
              <LeaderboardRow key={`${entry.rank}-${entry.username}`} entry={entry} compact />
            ))}
            {!meVisible && me ? (
              <LeaderboardRow
                entry={{
                  rank: me.rank,
                  username: "you",
                  reviews: me.reviews,
                  isMe: true,
                }}
                compact
              />
            ) : null}
          </div>
        ) : (
          <div style={s.empty}>
            <i className="ri-trophy-line" aria-hidden style={s.emptyIcon} />
            <span>No reviews this week yet — be the first on the board!</span>
          </div>
        )}

        <div style={s.footer}>
          <span style={s.summary}>{summary}</span>
        </div>
      </div>
      {modal}
    </>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    minWidth: 0,
    height: "100%",
    minHeight: "var(--overview-panel-min-height)",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 14,
    padding: "20px 24px",
    cursor: "pointer",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
    gap: 12,
  },
  title: {
    font: "600 16px/24px var(--font-sans)",
    color: "var(--ink-900)",
  },
  periodBadge: {
    flexShrink: 0,
    font: "500 12px/1 var(--font-sans)",
    color: "var(--fg-secondary)",
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-1)",
    borderRadius: 999,
    padding: "5px 12px",
  },
  rows: {
    flex: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 10,
  },
  empty: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    textAlign: "center",
    color: "var(--fg-4)",
    font: "400 13px/18px var(--font-sans)",
    padding: "0 8px",
  },
  emptyIcon: {
    fontSize: 26,
    color: "var(--orange-500)",
  },
  footer: {
    marginTop: 12,
    display: "flex",
    alignItems: "center",
  },
  summary: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
