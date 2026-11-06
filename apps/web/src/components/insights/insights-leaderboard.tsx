"use client";

import { useState } from "react";
import { ChartCard } from "@/components/insights/insights-charts";
import { OfflineNotice } from "@/components/offline-gate";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { useLeaderboard } from "@/lib/client-cache/hooks/use-leaderboard";
import { useOnline } from "@/lib/offline/use-online";
import type { LeaderboardEntry, LeaderboardPeriod } from "@/lib/stats/leaderboard";

const PERIODS: Array<{ id: LeaderboardPeriod; label: string }> = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "all", label: "All time" },
];

function LeaderboardRow({ entry }: { entry: LeaderboardEntry }) {
  return (
    <div className={`dh-board__row${entry.isMe ? " is-me" : ""}`}>
      <span className="dh-board__rank">{entry.rank}</span>
      <span className="dh-board__name">{entry.isMe ? "You" : `@${entry.username}`}</span>
      <span className="dh-board__value">{entry.reviews.toLocaleString()}</span>
    </div>
  );
}

export function InsightsLeaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>("week");
  const online = useOnline();
  const { data, error, isLoading, mutate } = useLeaderboard(period, online);

  const entries = data?.entries ?? [];
  const me = data?.me ?? null;
  const meVisible = entries.some((entry) => entry.isMe);

  return (
    <ChartCard
      title="Leaderboard"
      className="dh-insights__wide"
      aside={
        <span className="dh-seg dh-seg--compact" role="tablist" aria-label="Leaderboard period">
          {PERIODS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={option.id === period}
              onClick={() => setPeriod(option.id)}
            >
              {option.label}
            </button>
          ))}
        </span>
      }
    >
      {!online && !data ? (
        <OfflineNotice feature="The leaderboard" />
      ) : !data && error ? (
        <LoadErrorState label="the leaderboard" onRetry={() => void mutate()} compact />
      ) : !data ? (
        <SkeletonBar height={38} radius={9} />
      ) : entries.length === 0 ? (
        <p className="dh-chart__empty">No reviews in this period yet.</p>
      ) : (
        <div className={`dh-board${isLoading ? " is-loading" : ""}`}>
          {entries.map((entry) => (
            <LeaderboardRow key={`${entry.rank}-${entry.username}`} entry={entry} />
          ))}
          {!meVisible && me ? (
            <>
              <div className="dh-board__gap">…</div>
              <LeaderboardRow
                entry={{ rank: me.rank, username: "you", reviews: me.reviews, isMe: true }}
              />
            </>
          ) : null}
        </div>
      )}
      <p className="dh-chart__foot">Ranked by cards reviewed.</p>
    </ChartCard>
  );
}
