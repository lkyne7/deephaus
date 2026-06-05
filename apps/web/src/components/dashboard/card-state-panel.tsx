"use client";

import { m, useReducedMotion } from "motion/react";
import type { StateBreakdown } from "@/components/stat-cards";
import { motionTransition } from "@/lib/motion";

const SEGMENT_COLORS = {
  new: "var(--teal-500)",
  learning: "var(--orange-200)",
  review: "var(--teal-700)",
  relearning: "var(--grade-again)",
} as const;

function SegmentedDonut({
  breakdown,
  total,
  size = 100,
}: {
  breakdown: StateBreakdown;
  total: number;
  size?: number;
}) {
  const reducedMotion = useReducedMotion();
  const r = size * 0.4;
  const stroke = size * 0.17;
  const c = 2 * Math.PI * r;
  const center = size / 2;
  const segments: Array<{ key: keyof StateBreakdown; value: number; color: string }> = [
    { key: "new", value: breakdown.new, color: SEGMENT_COLORS.new },
    { key: "learning", value: breakdown.learning, color: SEGMENT_COLORS.learning },
    { key: "review", value: breakdown.review, color: SEGMENT_COLORS.review },
    { key: "relearning", value: breakdown.relearning, color: SEGMENT_COLORS.relearning },
  ];

  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <g transform={`rotate(-90 ${center} ${center})`}>
        <circle
          cx={center}
          cy={center}
          r={r}
          stroke="var(--ink-25)"
          strokeWidth={stroke}
          fill="none"
        />
        {total > 0 &&
          segments.map((seg, i) => {
            if (seg.value === 0) return null;
            const len = (seg.value / total) * c;
            const dasharray = `${len} ${c - len}`;
            const dashoffset = -offset;
            offset += len;
            return (
              <m.circle
                key={seg.key}
                cx={center}
                cy={center}
                r={r}
                stroke={seg.color}
                strokeWidth={stroke}
                fill="none"
                strokeDasharray={dasharray}
                initial={{ strokeDashoffset: reducedMotion ? dashoffset : c + dashoffset }}
                animate={{ strokeDashoffset: dashoffset }}
                transition={{
                  ...motionTransition(0.32, undefined, reducedMotion ?? false),
                  delay: reducedMotion ? 0 : i * 0.06,
                }}
              />
            );
          })}
      </g>
    </svg>
  );
}

function LegendRow({
  color,
  label,
  value,
}: {
  color: string;
  label: string;
  value: number;
}) {
  return (
    <div style={s.legendRow}>
      <span style={{ ...s.dot, background: color }} />
      <span style={s.legendLabel}>{label}</span>
      <span style={s.legendValue}>{value}</span>
    </div>
  );
}

type Props = {
  totalCards: number;
  breakdown: StateBreakdown;
  streak: number;
  reviewedToday: number;
  cardsWaiting: number;
  retentionPct: number | null;
};

export function CardStatePanel({
  totalCards,
  breakdown,
  streak,
  reviewedToday,
  cardsWaiting,
  retentionPct,
}: Props) {
  const retentionDisplay =
    retentionPct !== null ? `${Math.round(retentionPct * 100)}%` : "—";

  const segmentTotal =
    breakdown.new + breakdown.learning + breakdown.review + breakdown.relearning;
  const donutBreakdown =
    segmentTotal > 0
      ? breakdown
      : totalCards > 0
        ? { new: totalCards, learning: 0, review: 0, relearning: 0 }
        : breakdown;
  const donutTotal = Math.max(segmentTotal > 0 ? segmentTotal : totalCards, 1);

  return (
    <aside style={s.panelFill}>
      <div style={s.chartSection}>
        <div style={s.donutWrap}>
          <SegmentedDonut breakdown={donutBreakdown} total={donutTotal} />
          <div style={s.donutCenter}>
            <div style={s.donutTotal}>{totalCards}</div>
            <div style={s.donutLabel}>Cards</div>
          </div>
        </div>
        <div style={s.legend}>
          <LegendRow color={SEGMENT_COLORS.new} label="New" value={breakdown.new} />
          <LegendRow color={SEGMENT_COLORS.review} label="Review" value={breakdown.review} />
          <LegendRow color={SEGMENT_COLORS.learning} label="Learning" value={breakdown.learning} />
          {breakdown.relearning > 0 && (
            <LegendRow color={SEGMENT_COLORS.relearning} label="Lapsed" value={breakdown.relearning} />
          )}
        </div>
      </div>

      <div style={s.divider} />

      <div style={{ ...s.streakSection, marginTop: "auto" }}>
        <div style={s.statsRow}>
          <div style={s.statBlock}>
            <i className="ri-fire-fill" style={s.streakIcon} />
            <div>
              <div style={s.statValue}>
                {streak} day{streak === 1 ? "" : "s"}
              </div>
              <div style={s.statLabel}>Study streak</div>
            </div>
          </div>
          <div style={s.statBlock}>
            <i className="ri-pie-chart-2-line" style={s.retentionIcon} />
            <div>
              <div style={s.statValue}>{retentionDisplay}</div>
              <div style={s.statLabel}>30d retention</div>
            </div>
          </div>
        </div>
        <div style={s.meta} title="Retention over the last 30 days">
          {reviewedToday > 0
            ? `${reviewedToday} reviewed today`
            : streak > 0
              ? "Study today to keep it going"
              : "Start studying to build a streak"}
          {cardsWaiting > 0 && (
            <>
              {" · "}
              {cardsWaiting} waiting
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  panelFill: {
    width: "100%",
    height: "100%",
    minHeight: "var(--overview-panel-min-height)",
    boxSizing: "border-box",
    flexShrink: 0,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: "18px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  chartSection: {
    display: "flex",
    alignItems: "center",
    gap: 12,
  },
  donutWrap: {
    position: "relative",
    width: 100,
    height: 100,
    flexShrink: 0,
  },
  donutCenter: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  donutTotal: {
    font: "600 22px/1 var(--font-sans)",
    color: "var(--ink-900)",
    letterSpacing: "-0.02em",
  },
  donutLabel: {
    font: "500 10px/1 var(--font-sans)",
    color: "var(--fg-4)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    marginTop: 3,
  },
  legend: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  },
  legendRow: {
    display: "grid",
    gridTemplateColumns: "8px 1fr auto",
    alignItems: "center",
    gap: "4px 8px",
    font: "400 12px/16px var(--font-sans)",
    color: "var(--ink-500)",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: "50%",
  },
  legendLabel: {
    color: "var(--fg-4)",
  },
  legendValue: {
    fontWeight: 600,
    color: "var(--ink-700)",
  },
  divider: {
    height: 1,
    background: "var(--border-1)",
  },
  streakSection: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 10,
  },
  statBlock: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  streakIcon: {
    fontSize: 22,
    color: "var(--orange-300)",
    flexShrink: 0,
  },
  retentionIcon: {
    fontSize: 22,
    color: "var(--teal-500)",
    flexShrink: 0,
  },
  statValue: {
    font: "600 16px/20px var(--font-sans)",
    color: "var(--ink-900)",
  },
  statLabel: {
    font: "400 10px/12px var(--font-sans)",
    color: "var(--fg-4)",
    textTransform: "uppercase",
    letterSpacing: ".04em",
  },
  meta: {
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
