"use client";

import { useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { LeaderboardRow } from "@/components/dashboard/leaderboard-row";
import { OfflineNotice } from "@/components/offline-gate";
import { LeaderboardRowsSkeleton } from "@/components/ui/skeleton-patterns";
import { useLeaderboard } from "@/lib/client-cache/hooks/use-leaderboard";
import { useOnline } from "@/lib/offline/use-online";
import type { LeaderboardPeriod } from "@/lib/stats/leaderboard";

type Props = {
  open: boolean;
  onClose: () => void;
};

const PERIOD_TABS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
];

export function LeaderboardModal({ open, onClose }: Props) {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const online = useOnline();
  const { data, isLoading } = useLeaderboard(period, open && online);

  const entries = data?.entries ?? [];
  const me = data?.me ?? null;
  const meVisible = entries.some((entry) => entry.isMe);

  return (
    <AnimatedModal title="Leaderboard" open={open} onClose={onClose} maxWidth={520}>
      <div style={s.root}>
        <div style={s.tabs} role="tablist" aria-label="Leaderboard period">
          {PERIOD_TABS.map((tab) => {
            const active = tab.id === period;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                className={active ? "btn btn-secondary btn-sm" : "btn btn-ghost btn-sm"}
                onClick={() => setPeriod(tab.id)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {!online && !data ? (
          <OfflineNotice feature="The leaderboard" />
        ) : !data && isLoading ? (
          <LeaderboardRowsSkeleton rows={7} />
        ) : entries.length === 0 ? (
          <div style={s.loading}>
            <i className="ri-trophy-line" aria-hidden style={{ fontSize: 22 }} />
            <span>No reviews in this period yet.</span>
          </div>
        ) : (
          <div style={{ ...s.list, opacity: isLoading ? 0.55 : 1 }}>
            {entries.map((entry) => (
              <LeaderboardRow key={`${entry.rank}-${entry.username}`} entry={entry} />
            ))}
            {!meVisible && me ? (
              <>
                <div style={s.gap}>…</div>
                <LeaderboardRow
                  entry={{
                    rank: me.rank,
                    username: "you",
                    reviews: me.reviews,
                    isMe: true,
                  }}
                />
              </>
            ) : null}
          </div>
        )}

        <p style={s.footnote}>Ranked by cards reviewed. Keep studying to climb the board!</p>
      </div>
    </AnimatedModal>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  tabs: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    maxHeight: "min(56vh, 520px)",
    overflowY: "auto",
    transition: "opacity 0.15s ease",
  },
  gap: {
    textAlign: "center",
    color: "var(--fg-4)",
    font: "600 14px/16px var(--font-sans)",
    padding: "2px 0",
  },
  loading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    minHeight: 200,
    color: "var(--fg-4)",
    font: "400 13px/18px var(--font-sans)",
  },
  footnote: {
    margin: 0,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
