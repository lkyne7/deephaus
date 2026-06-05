"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { AdvancedStatsSkeleton } from "@/components/ui/skeleton-patterns";

type DayCount = { date: string; count: number };

type AdvancedStats = {
  scope: { deck_id: string | null; deck_name: string | null };
  total_cards: number;
  total_reviews: number;
  reviews_30d: number;
  retention_30d: number | null;
  retention_window_days: number;
  rating_window_days: number;
  mature_cards: number;
  avg_stability: number | null;
  avg_difficulty: number | null;
  streak: number;
  rating_distribution: { again: number; hard: number; good: number; easy: number };
  maturity: { new: number; learning: number; young: number; mature: number; suspended: number };
  state_breakdown: { new: number; learning: number; review: number; relearning: number };
  reviews_per_day: DayCount[];
  due_forecast: DayCount[];
};

export type AdvancedStatsDeckOption = { id: string; title: string };

type Props = {
  open: boolean;
  onClose: () => void;
  deckOptions: AdvancedStatsDeckOption[];
  initialDeckId?: string | null;
};

const ALL = "all";

function pct(value: number | null): string {
  return value !== null ? `${Math.round(value * 100)}%` : "—";
}

function formatStability(days: number | null): string {
  if (days === null) return "—";
  if (days >= 365) return `${(days / 365).toFixed(1)}y`;
  if (days >= 30) return `${(days / 30).toFixed(1)}mo`;
  if (days >= 1) return `${days.toFixed(0)}d`;
  return `${(days * 24).toFixed(0)}h`;
}

function shortDay(iso: string): { weekday: string; day: string } {
  const d = new Date(`${iso}T00:00:00`);
  return {
    weekday: d.toLocaleDateString("en-US", { weekday: "short" }),
    day: String(d.getDate()),
  };
}

export function AdvancedStatsModal({ open, onClose, deckOptions, initialDeckId = null }: Props) {
  const [scope, setScope] = useState<string>(initialDeckId ?? ALL);
  const [stats, setStats] = useState<AdvancedStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setScope(initialDeckId ?? ALL);
  }, [open, initialDeckId]);

  const load = useCallback(async (target: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/stats/advanced?deck=${target}`, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Could not load statistics");
      }
      setStats((await res.json()) as AdvancedStats);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load statistics");
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load(scope);
  }, [open, scope, load]);

  const title = useMemo(() => {
    if (scope === ALL) return "Stats";
    const deck = deckOptions.find((d) => d.id === scope);
    return deck ? `Stats · ${deck.title}` : "Stats";
  }, [scope, deckOptions]);

  return (
    <AnimatedModal title={title} open={open} onClose={onClose} maxWidth={900}>
      <div style={s.deckRow}>
        <select
          id="advanced-stats-deck"
          aria-label="Deck"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          style={s.deckSelect}
        >
          <option value={ALL}>All decks</option>
          {deckOptions.map((d) => (
            <option key={d.id} value={d.id}>
              {d.title}
            </option>
          ))}
        </select>
      </div>

      {error && !stats ? (
        <div className="notice notice-error">{error}</div>
      ) : stats ? (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s ease" }}>
          <AdvancedStatsBody stats={stats} />
        </div>
      ) : (
        <AdvancedStatsSkeleton />
      )}
    </AnimatedModal>
  );
}

function AdvancedStatsBody({ stats }: { stats: AdvancedStats }) {
  const ratingTotal =
    stats.rating_distribution.again +
    stats.rating_distribution.hard +
    stats.rating_distribution.good +
    stats.rating_distribution.easy;

  const maturityTotal =
    stats.maturity.new + stats.maturity.learning + stats.maturity.young + stats.maturity.mature;

  const maturePct = maturityTotal > 0 ? stats.maturity.mature / maturityTotal : null;

  return (
    <div style={s.body}>
      <div style={s.tileGrid}>
        <MetricTile icon="ri-stack-line" label="Total cards" value={stats.total_cards.toLocaleString()} />
        <MetricTile icon="ri-repeat-line" label="Total reviews" value={stats.total_reviews.toLocaleString()} />
        <MetricTile
          icon="ri-pie-chart-2-line"
          label={`${stats.retention_window_days}d retention`}
          value={pct(stats.retention_30d)}
          accent="var(--teal-500)"
        />
        <MetricTile icon="ri-fire-fill" label="Study streak" value={`${stats.streak}d`} accent="var(--orange-300)" />
        <MetricTile icon="ri-shield-check-line" label="Mature" value={pct(maturePct)} accent="var(--teal-700)" />
        <MetricTile icon="ri-time-line" label="Avg interval" value={formatStability(stats.avg_stability)} />
        <MetricTile
          icon="ri-bar-chart-grouped-line"
          label="Avg difficulty"
          value={stats.avg_difficulty !== null ? `${stats.avg_difficulty.toFixed(1)}/10` : "—"}
        />
        <MetricTile
          icon="ri-calendar-check-line"
          label={`Reviews (${stats.retention_window_days}d)`}
          value={stats.reviews_30d.toLocaleString()}
        />
      </div>

      <div style={s.columns}>
        <section style={s.card}>
          <h3 style={s.cardTitle}>Answer buttons</h3>
          <p style={s.cardHint}>Last {stats.rating_window_days} days · {ratingTotal.toLocaleString()} reviews</p>
          <div style={s.barList}>
            <DistributionBar label="Again" value={stats.rating_distribution.again} total={ratingTotal} color="var(--grade-again)" />
            <DistributionBar label="Hard" value={stats.rating_distribution.hard} total={ratingTotal} color="var(--orange-300)" />
            <DistributionBar label="Good" value={stats.rating_distribution.good} total={ratingTotal} color="var(--teal-500)" />
            <DistributionBar label="Easy" value={stats.rating_distribution.easy} total={ratingTotal} color="var(--teal-700)" />
          </div>
        </section>

        <section style={s.card}>
          <h3 style={s.cardTitle}>Card maturity</h3>
          <p style={s.cardHint}>{maturityTotal.toLocaleString()} active cards</p>
          <div style={s.barList}>
            <DistributionBar label="New" value={stats.maturity.new} total={maturityTotal} color="var(--brand-300)" />
            <DistributionBar label="Learning" value={stats.maturity.learning} total={maturityTotal} color="var(--orange-300)" />
            <DistributionBar label="Young" value={stats.maturity.young} total={maturityTotal} color="var(--teal-400)" />
            <DistributionBar label="Mature" value={stats.maturity.mature} total={maturityTotal} color="var(--teal-700)" />
          </div>
          {stats.maturity.suspended > 0 ? (
            <p style={s.cardHint}>{stats.maturity.suspended.toLocaleString()} suspended (excluded)</p>
          ) : null}
        </section>
      </div>

      <section style={s.card}>
        <h3 style={s.cardTitle}>Reviews per day</h3>
        <p style={s.cardHint}>Last {stats.reviews_per_day.length} days</p>
        <MiniBars data={stats.reviews_per_day} color="var(--teal-500)" emptyLabel="No reviews logged yet" />
      </section>

      <section style={s.card}>
        <h3 style={s.cardTitle}>Upcoming reviews</h3>
        <p style={s.cardHint}>Cards becoming due over the next {stats.due_forecast.length} days</p>
        <MiniBars data={stats.due_forecast} color="var(--orange-300)" emptyLabel="Nothing scheduled" labelFirstAs="Due now" />
      </section>
    </div>
  );
}

function MetricTile({
  icon,
  label,
  value,
  accent = "var(--ink-700)",
}: {
  icon: string;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div style={s.tile}>
      <i className={icon} style={{ ...s.tileIcon, color: accent }} />
      <div style={s.tileValue}>{value}</div>
      <div style={s.tileLabel}>{label}</div>
    </div>
  );
}

function DistributionBar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value: number;
  total: number;
  color: string;
}) {
  const ratio = total > 0 ? value / total : 0;
  return (
    <div style={s.barRow}>
      <span style={s.barLabel}>{label}</span>
      <span style={s.barTrack}>
        <span style={{ ...s.barFill, width: `${Math.max(ratio * 100, value > 0 ? 2 : 0)}%`, background: color }} />
      </span>
      <span style={s.barValue}>
        {value.toLocaleString()}
        <span style={s.barPct}>{total > 0 ? ` ${Math.round(ratio * 100)}%` : ""}</span>
      </span>
    </div>
  );
}

function MiniBars({
  data,
  color,
  emptyLabel,
  labelFirstAs,
}: {
  data: DayCount[];
  color: string;
  emptyLabel: string;
  labelFirstAs?: string;
}) {
  const max = data.reduce((m, d) => Math.max(m, d.count), 0);
  const totalCount = data.reduce((sum, d) => sum + d.count, 0);

  if (totalCount === 0) {
    return <div style={s.chartEmpty}>{emptyLabel}</div>;
  }

  return (
    <div style={s.chart}>
      {data.map((d, i) => {
        const height = max > 0 ? Math.max((d.count / max) * 100, d.count > 0 ? 6 : 0) : 0;
        const { weekday, day } = shortDay(d.date);
        const firstLabel = i === 0 && labelFirstAs ? labelFirstAs : undefined;
        return (
          <div key={d.date} style={s.chartCol} title={`${d.count} on ${d.date}`}>
            <div style={s.chartBarWrap}>
              <div style={{ ...s.chartBar, height: `${height}%`, background: color }} />
            </div>
            <div style={s.chartTick}>{firstLabel ?? day}</div>
            {!firstLabel ? <div style={s.chartTickSub}>{weekday}</div> : <div style={s.chartTickSub}>&nbsp;</div>}
          </div>
        );
      })}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  deckRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 16,
    flexWrap: "wrap",
  },
  deckSelect: {
    minWidth: 220,
    maxWidth: 360,
    flex: 1,
    font: "500 14px/20px var(--font-sans)",
    color: "var(--ink-700)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: "8px 12px",
    background: "var(--white)",
  },
  loadingHint: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-4)",
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  },
  centered: { padding: "48px 0", textAlign: "center" },
  body: { display: "flex", flexDirection: "column", gap: 16 },
  tileGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },
  tile: {
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-1)",
    borderRadius: 8,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  tileIcon: { fontSize: 18, marginBottom: 2 },
  tileValue: {
    font: "600 20px/26px var(--font-sans)",
    color: "var(--ink-900)",
    letterSpacing: "-0.01em",
  },
  tileLabel: {
    font: "400 11px/14px var(--font-sans)",
    color: "var(--fg-4)",
    textTransform: "uppercase",
    letterSpacing: "0.04em",
  },
  columns: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 16,
  },
  card: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  },
  cardTitle: {
    margin: 0,
    font: "600 14px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  cardHint: {
    margin: 0,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  barList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 6 },
  barRow: {
    display: "grid",
    gridTemplateColumns: "64px 1fr 78px",
    alignItems: "center",
    gap: 10,
  },
  barLabel: {
    font: "500 12px/16px var(--font-sans)",
    color: "var(--fg-3)",
  },
  barTrack: {
    height: 8,
    borderRadius: 999,
    background: "var(--ink-25)",
    overflow: "hidden",
  },
  barFill: {
    display: "block",
    height: "100%",
    borderRadius: 999,
    transition: "width 0.3s ease",
  },
  barValue: {
    font: "600 12px/16px var(--font-sans)",
    color: "var(--ink-700)",
    textAlign: "right",
  },
  barPct: {
    font: "400 11px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  chart: {
    display: "flex",
    alignItems: "flex-end",
    gap: 3,
    height: 120,
    marginTop: 6,
  },
  chartCol: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
    height: "100%",
  },
  chartBarWrap: {
    flex: 1,
    width: "100%",
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  chartBar: {
    width: "100%",
    maxWidth: 18,
    borderRadius: "3px 3px 0 0",
    minHeight: 0,
  },
  chartTick: {
    font: "500 9px/12px var(--font-sans)",
    color: "var(--fg-4)",
    whiteSpace: "nowrap",
  },
  chartTickSub: {
    font: "400 8px/10px var(--font-sans)",
    color: "var(--fg-placeholder)",
    whiteSpace: "nowrap",
  },
  chartEmpty: {
    padding: "32px 0",
    textAlign: "center",
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
