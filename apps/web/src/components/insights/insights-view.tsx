"use client";

import { useState } from "react";
import { ActivityHeatmap } from "@/components/insights/activity-heatmap";
import { ChartCard, ColumnChart, ShareChart } from "@/components/insights/insights-charts";
import { InsightsLeaderboard } from "@/components/insights/insights-leaderboard";
import { OfflineNotice } from "@/components/offline-gate";
import { useSettings } from "@/components/settings/settings-context";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { AdvancedStatsError, useAdvancedStats } from "@/lib/client-cache/hooks/use-advanced-stats";
import { useDashboardStats } from "@/lib/client-cache/hooks/use-dashboard-stats";
import type { AdvancedStats } from "@/lib/fsrs/advanced-stats";
import { useOnline } from "@/lib/offline/use-online";
import { formatInterval, groupByWeek, peakOf, shortDate } from "@/lib/stats/insights";
import "./insights.css";

const ALL = "all";

const RANGES = [
  { days: 7, label: "7d", window: "7-day" },
  { days: 30, label: "30d", window: "30-day" },
  { days: 365, label: "1y", window: "1-year" },
] as const;

type Range = (typeof RANGES)[number];

const MISSING = "–";

function percent(value: number | null | undefined): string {
  return value === null || value === undefined ? MISSING : `${Math.round(value * 100)}%`;
}

function StatTile({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}

function ReviewsCard({ stats, range }: { stats: AdvancedStats; range: Range }) {
  const weekly = range.days === 365;
  const series = weekly ? groupByWeek(stats.reviews_per_day) : stats.reviews_per_day;
  const peak = peakOf(series);
  const first = series[0];
  const last = series[series.length - 1];
  return (
    <ChartCard
      title={weekly ? "Reviews per week" : "Reviews per day"}
      aside={
        peak
          ? `Peak ${peak.count.toLocaleString()} ${weekly ? "in week of" : "on"} ${shortDate(peak.date)}`
          : null
      }
    >
      <ColumnChart
        caption={weekly ? "Reviews per week" : "Reviews per day"}
        data={series}
        unit="review"
        describe={(point) => (weekly ? `Week of ${shortDate(point.date)}` : shortDate(point.date))}
        firstLabel={first ? shortDate(first.date) : ""}
        lastLabel={last ? shortDate(last.date) : ""}
        emptyLabel="No reviews logged yet"
      />
    </ChartCard>
  );
}

function UpcomingCard({ stats }: { stats: AdvancedStats }) {
  const series = stats.due_forecast;
  const today = series[0]?.count ?? 0;
  const last = series[series.length - 1];
  return (
    <ChartCard title="Upcoming reviews" aside={`${today.toLocaleString()} today`}>
      <ColumnChart
        caption="Upcoming reviews"
        data={series}
        unit="review"
        describe={(point, index) => (index === 0 ? "Due now" : shortDate(point.date))}
        firstLabel="Today"
        lastLabel={last ? shortDate(last.date) : ""}
        emptyLabel="Nothing scheduled"
      />
    </ChartCard>
  );
}

function AnswersCard({ stats }: { stats: AdvancedStats }) {
  const { again, hard, good, easy } = stats.rating_distribution;
  const total = again + hard + good + easy;
  return (
    <ChartCard title="Answer buttons" aside={`${total.toLocaleString()} reviews`}>
      <ShareChart
        caption="Answer buttons"
        unit="review"
        emptyLabel="No reviews in this period yet"
        rows={[
          { label: "Again", value: again, color: "var(--grade-again)" },
          { label: "Hard", value: hard, color: "var(--grade-hard)" },
          { label: "Good", value: good, color: "var(--grade-good)" },
          { label: "Easy", value: easy, color: "var(--grade-easy)" },
        ]}
      />
    </ChartCard>
  );
}

function MaturityCard({ stats }: { stats: AdvancedStats }) {
  const { new: fresh, learning, young, mature, suspended } = stats.maturity;
  const total = fresh + learning + young + mature;
  return (
    <ChartCard title="Card maturity" aside={`${total.toLocaleString()} active cards`}>
      <ShareChart
        caption="Card maturity"
        unit="card"
        emptyLabel="No cards yet"
        rows={[
          { label: "New", value: fresh, color: "var(--heat-1)" },
          { label: "Learning", value: learning, color: "var(--heat-2)" },
          { label: "Young", value: young, color: "var(--heat-3)" },
          { label: "Mature", value: mature, color: "var(--heat-4)" },
        ]}
      />
      {suspended > 0 ? (
        <p className="dh-chart__foot">{suspended.toLocaleString()} suspended, not counted</p>
      ) : null}
    </ChartCard>
  );
}

function ChartsSkeleton() {
  return (
    <>
      {[0, 1, 2, 3].map((key) => (
        <section key={key} className="dh-surface dh-chart">
          <SkeletonBar width={120} height={12} style={{ marginBottom: 16 }} />
          <SkeletonBar height={132} radius={8} />
        </section>
      ))}
    </>
  );
}

export function InsightsView({ initialDeckId }: { initialDeckId: string | null }) {
  const [deck, setDeck] = useState(initialDeckId ?? ALL);
  const [range, setRange] = useState<Range>(RANGES[1]);
  const online = useOnline();
  const { openSettings } = useSettings();
  const { data: overview } = useDashboardStats();
  const { data: stats, error, isLoading, mutate } = useAdvancedStats(deck, range.days, online);

  const locked = error instanceof AdvancedStatsError && error.status === 402;
  const allDecks = deck === ALL;
  const fallback = allDecks ? overview : undefined;

  const retention = stats ? stats.retention_30d : range.days === 30 ? fallback?.retention_pct : null;
  const streak = stats?.streak ?? fallback?.streak;
  const totalCards = stats?.total_cards ?? fallback?.total_cards;

  return (
    <div className="dh-page dh-insights">
      <div className="dh-page-head">
        <h1 className="dh-title">Insights</h1>
        <span className="dh-spacer" />
        <label className="dh-insights__deck">
          <span className="dh-insights__deck-label">
            {overview?.per_deck.find((option) => option.deck_id === deck)?.name ?? "All decks"}
          </span>
          <i className="ri-arrow-down-s-line" aria-hidden />
          <select
            aria-label="Deck"
            value={deck}
            disabled={!online}
            onChange={(event) => setDeck(event.target.value)}
          >
            <option value={ALL}>All decks</option>
            {overview?.per_deck.map((option) => (
              <option key={option.deck_id} value={option.deck_id}>
                {option.name}
              </option>
            ))}
          </select>
        </label>
        {online && !locked ? (
          <div className="dh-seg" role="group" aria-label="Date range">
            {RANGES.map((option) => (
              <button
                key={option.days}
                type="button"
                aria-pressed={option.days === range.days}
                onClick={() => setRange(option)}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <section className={`dh-surface dh-insights__stats${isLoading ? " is-loading" : ""}`}>
        <StatTile value={totalCards?.toLocaleString() ?? MISSING} label="Total cards" />
        <StatTile value={stats?.total_reviews.toLocaleString() ?? MISSING} label="Total reviews" />
        <StatTile value={percent(retention)} label={`${range.window} retention`} />
        <StatTile
          value={streak === undefined ? MISSING : `${streak} day${streak === 1 ? "" : "s"}`}
          label="Study streak"
        />
        <StatTile value={stats?.mature_cards.toLocaleString() ?? MISSING} label="Mature" />
        <StatTile value={stats ? formatInterval(stats.avg_stability) : MISSING} label="Avg interval" />
        <StatTile
          value={stats?.avg_difficulty?.toFixed(1) ?? MISSING}
          label="Avg difficulty"
        />
        <StatTile
          value={stats?.reviews_30d.toLocaleString() ?? MISSING}
          label={`Reviews (${range.label})`}
        />
      </section>

      <ActivityHeatmap deckId={allDecks ? null : deck} />

      <div className={`dh-insights__grid${isLoading && stats ? " is-loading" : ""}`}>
        {!online ? (
          <div className="dh-insights__wide">
            <OfflineNotice feature="Detailed statistics" />
          </div>
        ) : locked ? (
          <div className="dh-note dh-insights__wide">
            <i className="ri-vip-crown-line" aria-hidden />
            <span>
              Review history, answer buttons and card maturity come with Plus.{" "}
              <button type="button" onClick={() => openSettings("billing")}>
                Upgrade
              </button>
            </span>
          </div>
        ) : stats ? (
          <>
            <ReviewsCard stats={stats} range={range} />
            <UpcomingCard stats={stats} />
            <AnswersCard stats={stats} />
            <MaturityCard stats={stats} />
          </>
        ) : error ? (
          <div className="dh-insights__wide">
            <LoadErrorState label="your statistics" onRetry={() => void mutate()} compact />
          </div>
        ) : (
          <ChartsSkeleton />
        )}
        <InsightsLeaderboard />
      </div>
    </div>
  );
}
