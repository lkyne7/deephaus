"use client";

import Link from "next/link";

type Props = {
  totalCards: number;
  newCards: number;
  reviewCards: number;
  streak: number;
  dueCards: number;
  studyHref?: string;
};

function Donut({ value, total }: { value: number; total: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const pct = total === 0 ? 0 : Math.min(1, value / total);
  return (
    <svg width="130" height="130" viewBox="0 0 130 130">
      <g transform="rotate(-90 65 65)">
        <circle cx="65" cy="65" r={r} stroke="var(--teal-100)" strokeWidth="22" fill="none" />
        <circle
          cx="65"
          cy="65"
          r={r}
          stroke="var(--teal-500)"
          strokeWidth="22"
          fill="none"
          strokeDasharray={`${c * pct} ${c}`}
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}

export function StatCards({ totalCards, newCards, reviewCards, streak, dueCards, studyHref }: Props) {
  return (
    <div style={s.row}>
      <div style={s.card}>
        <div style={{ position: "relative", width: 130, height: 130 }}>
          <Donut value={newCards} total={Math.max(totalCards, 1)} />
          <div style={s.donutCenter}>
            <div style={{ font: "600 26px/1 var(--font-sans)", color: "var(--ink-900)" }}>{totalCards}</div>
            <div style={s.donutLabel}>Cards</div>
          </div>
        </div>
        <div style={s.legend}>
          <span>
            <span style={{ ...s.dot, background: "var(--teal-500)" }} />
            New {newCards}
          </span>
          <span>
            <span style={{ ...s.dot, background: "var(--teal-100)" }} />
            Review {reviewCards}
          </span>
        </div>
      </div>

      <div style={s.card}>
        <div style={s.bigNum}>{streak}</div>
        <div style={s.lbl}>Days in a row</div>
        <div style={{ fontSize: 28, marginTop: 4 }}>
          <i className="ri-star-fill" style={{ color: "var(--orange-200)" }} />
        </div>
        <div style={s.sub}>{streak > 0 ? "Keep it up" : "Start your streak"}</div>
      </div>

      <div style={s.card}>
        <div style={s.bigNum}>{dueCards}</div>
        <div style={s.lbl}>Cards due today</div>
        {studyHref ? (
          <Link href={studyHref} className="btn btn-primary btn-sm" style={{ marginTop: 12 }}>
            Study Now <i className="ri-arrow-right-line" />
          </Link>
        ) : (
          <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} disabled>
            All caught up
          </button>
        )}
      </div>
    </div>
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
    minHeight: 220,
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
  legend: { display: "flex", gap: 16, font: "400 12px/1 var(--font-sans)", color: "var(--ink-500)" },
  dot: { width: 8, height: 8, borderRadius: "50%", display: "inline-block", marginRight: 6, verticalAlign: 1 },
  bigNum: { font: "600 64px/1 var(--font-sans)", color: "var(--ink-900)", letterSpacing: "-0.02em" },
  lbl: { font: "500 14px/20px var(--font-sans)", color: "var(--ink-700)" },
  sub: { font: "400 12px/16px var(--font-sans)", color: "var(--fg-4)" },
};
