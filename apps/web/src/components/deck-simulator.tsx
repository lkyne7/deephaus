"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { UntitledSelect } from "@/components/ui/untitled-controls";

type SimDay = {
  date: string;
  review: number;
  new: number;
  total: number;
};

type SimResponse = {
  inputs: {
    days: number;
    new_per_day: number;
    desired_retention: number;
    max_per_day: number | null;
    scheduled_cards: number;
    new_cards_remaining: number;
  };
  days: SimDay[];
  summary: {
    totalReviews: number;
    totalNew: number;
    averagePerDay: number;
    peak: { date: string; count: number };
  };
};

type Props = {
  projectId: string;
  defaultNewPerDay: number;
  defaultRetention: number;
};

const HORIZONS = [
  { value: 30, label: "1 month" },
  { value: 90, label: "3 months" },
  { value: 180, label: "6 months" },
  { value: 365, label: "1 year" },
];

export function DeckSimulator({ projectId, defaultNewPerDay, defaultRetention }: Props) {
  const [days, setDays] = useState(90);
  const [newPerDay, setNewPerDay] = useState(defaultNewPerDay);
  const [retentionPct, setRetentionPct] = useState(Math.round(defaultRetention * 100));
  const [maxPerDay, setMaxPerDay] = useState<number | "">("");
  const [data, setData] = useState<SimResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);

    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          days: String(days),
          newPerDay: String(Math.max(0, newPerDay)),
          retention: String(Math.min(0.99, Math.max(0.7, retentionPct / 100))),
        });
        if (maxPerDay !== "" && maxPerDay > 0) params.set("maxPerDay", String(maxPerDay));

        const res = await fetch(`/api/decks/${projectId}/simulate?${params}`, {
          credentials: "include",
        });
        const json = await res.json();
        if (seq !== requestSeq.current) return;
        if (!res.ok) throw new Error(json?.error ?? "Simulation failed");
        setData(json as SimResponse);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : "Simulation failed");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 350);

    return () => window.clearTimeout(timer);
  }, [projectId, days, newPerDay, retentionPct, maxPerDay]);

  return (
    <div className="surface" style={{ padding: 20 }}>
      <div style={s.head}>
        <div>
          <h3 style={s.title}>
            <i className="ri-line-chart-line" style={{ marginRight: 8, color: "var(--teal-700)" }} />
            Review forecast
          </h3>
          <p style={s.hint}>
            Simulated with your FSRS parameters — projected daily workload from cards already
            scheduled plus new cards you&apos;ll introduce.
          </p>
        </div>
      </div>

      <div style={s.controls}>
        <label style={s.control}>
          <span style={s.controlLabel}>Time period</span>
          <UntitledSelect value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {HORIZONS.map((h) => (
              <option key={h.value} value={h.value}>
                {h.label}
              </option>
            ))}
          </UntitledSelect>
        </label>
        <label style={s.control}>
          <span style={s.controlLabel}>New cards/day</span>
          <input
            type="number"
            min={0}
            max={500}
            value={newPerDay}
            onChange={(e) => setNewPerDay(Math.max(0, Number(e.target.value) || 0))}
            style={s.numInput}
          />
        </label>
        <label style={s.control}>
          <span style={s.controlLabel}>Desired retention %</span>
          <input
            type="number"
            min={70}
            max={99}
            value={retentionPct}
            onChange={(e) => setRetentionPct(Math.min(99, Math.max(70, Number(e.target.value) || 90)))}
            style={s.numInput}
          />
        </label>
        <label style={s.control}>
          <span style={s.controlLabel}>Max reviews/day</span>
          <input
            type="number"
            min={0}
            max={5000}
            placeholder="No limit"
            value={maxPerDay}
            onChange={(e) => {
              const raw = e.target.value;
              setMaxPerDay(raw === "" ? "" : Math.max(0, Number(raw) || 0));
            }}
            style={s.numInput}
          />
        </label>
      </div>

      {error ? (
        <div className="notice notice-error" style={{ marginTop: 16 }}>
          {error}
        </div>
      ) : (
        <>
          <div style={{ marginTop: 16, opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
            <ForecastChart days={data?.days ?? []} />
          </div>

          <div style={s.legendRow}>
            <span style={s.legendItem}>
              <span style={{ ...s.legendSwatch, background: "var(--teal-500)" }} />
              Review cards
            </span>
            <span style={s.legendItem}>
              <span style={{ ...s.legendSwatch, background: "var(--orange-300)" }} />
              New cards
            </span>
          </div>

          {data && (
            <div style={s.summaryRow}>
              <SummaryTile
                label="Total reviews"
                value={(data.summary.totalReviews + data.summary.totalNew).toLocaleString()}
              />
              <SummaryTile label="Average/day" value={data.summary.averagePerDay.toLocaleString()} />
              <SummaryTile
                label="Busiest day"
                value={`${data.summary.peak.count.toLocaleString()} on ${formatShortDate(data.summary.peak.date)}`}
              />
              <SummaryTile
                label="New cards left"
                value={data.inputs.new_cards_remaining.toLocaleString()}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const CHART_WIDTH = 920;
const CHART_HEIGHT = 180;
const AXIS_HEIGHT = 20;

function ForecastChart({ days }: { days: SimDay[] }) {
  const max = useMemo(() => days.reduce((m, d) => Math.max(m, d.total), 0), [days]);

  if (days.length === 0) {
    return (
      <div style={s.chartEmpty}>
        <i className="ri-loader-4-line icon-spin" style={{ fontSize: 20 }} />
      </div>
    );
  }

  const innerHeight = CHART_HEIGHT - AXIS_HEIGHT;
  const barWidth = CHART_WIDTH / days.length;
  const gap = barWidth > 4 ? 1 : 0;
  const scale = max > 0 ? innerHeight / max : 0;

  return (
    <div style={{ width: "100%", overflow: "hidden" }}>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        style={{ width: "100%", height: "auto", display: "block" }}
        role="img"
        aria-label="Projected reviews per day"
      >
        {/* gridlines at 25/50/75/100% */}
        {[0.25, 0.5, 0.75, 1].map((frac) => (
          <line
            key={frac}
            x1={0}
            x2={CHART_WIDTH}
            y1={innerHeight - innerHeight * frac}
            y2={innerHeight - innerHeight * frac}
            stroke="var(--border-secondary)"
            strokeDasharray="4 4"
            strokeWidth={1}
          />
        ))}
        {days.map((d, i) => {
          const reviewH = d.review * scale;
          const newH = d.new * scale;
          const x = i * barWidth;
          return (
            <g key={d.date}>
              <title>{`${formatShortDate(d.date)} — ${d.total} total (${d.review} review, ${d.new} new)`}</title>
              <rect
                x={x}
                y={innerHeight - reviewH}
                width={Math.max(barWidth - gap, 0.5)}
                height={reviewH}
                fill="var(--teal-500)"
              />
              <rect
                x={x}
                y={innerHeight - reviewH - newH}
                width={Math.max(barWidth - gap, 0.5)}
                height={newH}
                fill="var(--orange-300)"
              />
            </g>
          );
        })}
        <text x={0} y={CHART_HEIGHT - 4} style={s.axisText as React.CSSProperties}>
          {formatShortDate(days[0].date)}
        </text>
        <text
          x={CHART_WIDTH}
          y={CHART_HEIGHT - 4}
          textAnchor="end"
          style={s.axisText as React.CSSProperties}
        >
          {formatShortDate(days[days.length - 1].date)}
        </text>
        {max > 0 && (
          <text x={CHART_WIDTH} y={12} textAnchor="end" style={s.axisText as React.CSSProperties}>
            {max.toLocaleString()}/day
          </text>
        )}
      </svg>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.tile}>
      <div style={s.tileValue}>{value}</div>
      <div style={s.tileLabel}>{label}</div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const s: Record<string, React.CSSProperties> = {
  head: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
  },
  title: {
    font: "500 16px/24px var(--font-sans)",
    color: "var(--ink-900)",
    margin: 0,
  },
  hint: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-tertiary)",
    margin: "4px 0 0",
    maxWidth: 640,
  },
  controls: {
    display: "flex",
    gap: 16,
    flexWrap: "wrap",
    marginTop: 16,
  },
  control: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  controlLabel: {
    font: "500 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  numInput: {
    width: 120,
    height: 36,
    padding: "0 12px",
    borderRadius: 8,
    border: "1px solid var(--border-primary)",
    background: "var(--bg-primary)",
    color: "var(--fg-primary)",
    font: "400 14px/20px var(--font-sans)",
  },
  chartEmpty: {
    height: CHART_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--fg-quaternary)",
  },
  legendRow: {
    display: "flex",
    gap: 16,
    marginTop: 10,
  },
  legendItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-tertiary)",
  },
  legendSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    display: "inline-block",
  },
  summaryRow: {
    display: "flex",
    gap: 24,
    flexWrap: "wrap",
    marginTop: 16,
    paddingTop: 16,
    borderTop: "1px solid var(--border-secondary)",
  },
  tile: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    minWidth: 120,
  },
  tileValue: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--ink-900)",
    letterSpacing: "-0.01em",
  },
  tileLabel: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-quaternary)",
  },
  axisText: {
    font: "400 11px/14px var(--font-sans)",
    fill: "var(--fg-quaternary)",
  },
};
