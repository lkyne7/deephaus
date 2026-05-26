"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";

export type StateBreakdown = {
  new: number;
  learning: number;
  review: number;
  relearning: number;
};

type Props = {
  totalCards: number;
  breakdown: StateBreakdown;
  streak: number;
  dueCards: number;
  newToday: number;
  reviewedToday: number;
  retentionPct: number | null;
  studyHref?: string;
  lastOptimizedAt: string | null;
  fsrsLogCount: number;
  optimizerReady: boolean;
};

const SEGMENT_COLORS = {
  new: "var(--teal-500)",
  learning: "var(--orange-200)",
  review: "var(--teal-700)",
  relearning: "var(--grade-again)",
} as const;

function SegmentedDonut({ breakdown, total }: { breakdown: StateBreakdown; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const segments: Array<{ key: keyof StateBreakdown; value: number; color: string }> = [
    { key: "new", value: breakdown.new, color: SEGMENT_COLORS.new },
    { key: "learning", value: breakdown.learning, color: SEGMENT_COLORS.learning },
    { key: "review", value: breakdown.review, color: SEGMENT_COLORS.review },
    { key: "relearning", value: breakdown.relearning, color: SEGMENT_COLORS.relearning },
  ];

  let offset = 0;
  return (
    <svg width="130" height="130" viewBox="0 0 130 130">
      <g transform="rotate(-90 65 65)">
        <circle cx="65" cy="65" r={r} stroke="var(--ink-25)" strokeWidth="22" fill="none" />
        {total > 0 &&
          segments.map((seg) => {
            if (seg.value === 0) return null;
            const len = (seg.value / total) * c;
            const dasharray = `${len} ${c - len}`;
            const dashoffset = -offset;
            offset += len;
            return (
              <circle
                key={seg.key}
                cx="65"
                cy="65"
                r={r}
                stroke={seg.color}
                strokeWidth="22"
                fill="none"
                strokeDasharray={dasharray}
                strokeDashoffset={dashoffset}
              />
            );
          })}
      </g>
    </svg>
  );
}

export function StatCards(props: Props) {
  const {
    totalCards,
    breakdown,
    streak,
    dueCards,
    newToday,
    reviewedToday,
    retentionPct,
    studyHref,
    lastOptimizedAt,
    fsrsLogCount,
    optimizerReady,
  } = props;
  const router = useRouter();
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeError, setOptimizeError] = useState<string | null>(null);

  async function optimize() {
    setOptimizing(true);
    setOptimizeError(null);
    try {
      const res = await fetch("/api/fsrs/optimize", { method: "POST", credentials: "include" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "Failed to optimize");
      router.refresh();
    } catch (e) {
      setOptimizeError(e instanceof Error ? e.message : "Failed to optimize");
    } finally {
      setOptimizing(false);
    }
  }

  return (
    <div style={s.row}>
      <div style={s.card}>
        <div style={{ position: "relative", width: 130, height: 130 }}>
          <SegmentedDonut breakdown={breakdown} total={Math.max(totalCards, 1)} />
          <div style={s.donutCenter}>
            <div style={{ font: "600 26px/1 var(--font-sans)", color: "var(--ink-900)" }}>
              {totalCards}
            </div>
            <div style={s.donutLabel}>Cards</div>
          </div>
        </div>
        <div style={s.legend}>
          <LegendDot color={SEGMENT_COLORS.new} label="New" value={breakdown.new} />
          <LegendDot color={SEGMENT_COLORS.review} label="Review" value={breakdown.review} />
          <LegendDot color={SEGMENT_COLORS.learning} label="Learning" value={breakdown.learning} />
          {breakdown.relearning > 0 && (
            <LegendDot color={SEGMENT_COLORS.relearning} label="Lapsed" value={breakdown.relearning} />
          )}
        </div>
      </div>

      <div style={s.card}>
        <div style={s.bigNum}>{streak}</div>
        <div style={s.lbl}>Days in a row</div>
        <div style={{ fontSize: 28, marginTop: 4 }}>
          <i className="ri-fire-fill" style={{ color: "var(--orange-200)" }} />
        </div>
        <div style={s.sub}>
          {reviewedToday > 0
            ? `${reviewedToday} reviewed today`
            : streak > 0
              ? "Keep your streak going"
              : "Start your streak"}
        </div>
      </div>

      <div style={s.card}>
        <div style={s.bigNum}>{dueCards + newToday}</div>
        <div style={s.lbl}>{dueCards + newToday === 1 ? "Card waiting" : "Cards waiting"}</div>
        <div style={s.sub}>
          {dueCards} due {newToday > 0 ? `· ${newToday} new` : ""}
          {retentionPct !== null && (
            <>
              {" · "}
              <span title="Retention over the last 30 days">
                {Math.round(retentionPct * 100)}% retention
              </span>
            </>
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12, alignItems: "center" }}>
          {studyHref && dueCards + newToday > 0 ? (
            <Link href={studyHref} className="btn btn-primary btn-sm">
              Study Now <i className="ri-arrow-right-line" />
            </Link>
          ) : (
            <button className="btn btn-secondary btn-sm" disabled>
              All caught up
            </button>
          )}
          <button
            className="btn btn-ghost btn-sm"
            onClick={optimize}
            disabled={optimizing || !optimizerReady}
            title={
              optimizerReady
                ? lastOptimizedAt
                  ? `Last optimized ${new Date(lastOptimizedAt).toLocaleDateString()}`
                  : "Fit FSRS parameters to your review history"
                : `Need at least 100 reviews to optimize (you have ${fsrsLogCount})`
            }
            style={{ font: "500 12px/16px var(--font-sans)", padding: "6px 12px" }}
          >
            <i className="ri-equalizer-line" />
            {optimizing
              ? "Optimizing…"
              : lastOptimizedAt
                ? "Re-optimize FSRS"
                : "Optimize FSRS"}
          </button>
          {optimizeError && (
            <span style={{ color: "var(--grade-again)", font: "400 12px/16px var(--font-sans)" }}>
              {optimizeError}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function LegendDot({ color, label, value }: { color: string; label: string; value: number }) {
  return (
    <span>
      <span style={{ ...s.dot, background: color }} />
      {label} {value}
    </span>
  );
}

const s: Record<string, React.CSSProperties> = {
  row: { display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 },
  card: {
    background: "var(--white)",
    borderRadius: 12,
    border: "1px solid var(--border-2)",
    padding: 24,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    minHeight: 260,
    justifyContent: "center",
  },
  donutCenter: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
  },
  donutLabel: {
    font: "500 11px/1 var(--font-sans)",
    color: "var(--fg-4)",
    letterSpacing: ".06em",
    textTransform: "uppercase",
    marginTop: 4,
  },
  legend: {
    display: "flex",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 12,
    font: "400 12px/1 var(--font-sans)",
    color: "var(--ink-500)",
  },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 6, verticalAlign: 1 },
  bigNum: { font: "600 64px/1 var(--font-sans)", color: "var(--ink-900)", letterSpacing: "-0.02em" },
  lbl: { font: "500 14px/20px var(--font-sans)", color: "var(--ink-700)" },
  sub: { font: "400 12px/16px var(--font-sans)", color: "var(--fg-4)", textAlign: "center" },
};
