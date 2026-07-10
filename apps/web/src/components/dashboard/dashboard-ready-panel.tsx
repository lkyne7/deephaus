"use client";

import Link from "next/link";

/** Rough per-card review pace used only for the "About N minutes" estimate. */
const SECONDS_PER_CARD = 9;

type Props = {
  cardsReady: number;
  reviewedToday: number;
  dueNow: number;
  streak: number;
  retentionPct: number | null;
  /** Opens the statistics view when the card (outside its buttons) is clicked. */
  onOpenStats?: () => void;
};

/** Human-friendly study-time estimate ("About 28 minutes" / "About 2h 30m"). */
function estimateDuration(cards: number): string {
  const minutes = Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

function StatRow({
  icon,
  tintBg,
  tintFg,
  value,
  label,
}: {
  icon: string;
  tintBg: string;
  tintFg: string;
  value: string;
  label: string;
}) {
  return (
    <div style={s.statRow}>
      <span style={{ ...s.statIconChip, background: tintBg, color: tintFg }}>
        <i className={icon} aria-hidden />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={s.statValue}>{value}</div>
        <div style={s.statLabel}>{label}</div>
      </div>
    </div>
  );
}

const ORANGE_TINT = "color-mix(in srgb, var(--orange-500) 15%, transparent)";
const TEAL_TINT = "color-mix(in srgb, var(--brand-500) 15%, transparent)";

export function DashboardReadyPanel({
  cardsReady,
  reviewedToday,
  dueNow,
  streak,
  retentionPct,
  onOpenStats,
}: Props) {
  const hasWork = cardsReady > 0;
  const retentionDisplay =
    retentionPct !== null ? `${Math.round(retentionPct * 100)}%` : "—";

  const subline = hasWork
    ? `About ${estimateDuration(cardsReady)}${
        reviewedToday > 0 ? ` · ${reviewedToday} reviewed already` : ""
      }`
    : reviewedToday > 0
      ? `All caught up · ${reviewedToday} reviewed today`
      : "Nothing due right now — add or study a deck to get going";

  return (
    <aside
      style={s.panel}
      className={onOpenStats ? "dh-hero-card" : undefined}
      onClick={
        onOpenStats
          ? (e) => {
              // Let the Study / Custom session links handle their own clicks.
              if ((e.target as HTMLElement).closest("a, button")) return;
              onOpenStats();
            }
          : undefined
      }
    >
      <div style={s.cta}>
        <div>
          <h2 style={s.headline}>
            {hasWork ? (
              <>
                <span style={s.headlineNum}>{cardsReady.toLocaleString()}</span> cards ready for
                today
              </>
            ) : (
              "You're all caught up"
            )}
          </h2>
          <p style={s.subline}>{subline}</p>
        </div>

        <div style={s.actions}>
          <Link href="/study" className="btn btn-primary">
            {hasWork ? "Study Now" : "Study"}
            <i className="ri-arrow-right-line" aria-hidden />
          </Link>
          <Link href="/study" className="btn btn-ghost btn-sm">
            Custom session
          </Link>
        </div>
      </div>

      <div style={s.divider} />

      <div style={s.stats}>
        <StatRow
          icon="ri-time-line"
          tintBg={ORANGE_TINT}
          tintFg="var(--orange-500)"
          value={dueNow.toLocaleString()}
          label="Due today"
        />
        <StatRow
          icon="ri-fire-fill"
          tintBg={ORANGE_TINT}
          tintFg="var(--orange-500)"
          value={`${streak} day${streak === 1 ? "" : "s"}`}
          label="Study streak"
        />
        <StatRow
          icon="ri-pie-chart-2-line"
          tintBg={TEAL_TINT}
          tintFg="var(--brand-600)"
          value={retentionDisplay}
          label="30-day retention"
        />
      </div>
    </aside>
  );
}

const s: Record<string, React.CSSProperties> = {
  panel: {
    width: "100%",
    height: "100%",
    minHeight: "var(--overview-panel-min-height)",
    boxSizing: "border-box",
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 14,
    padding: 24,
    display: "flex",
    alignItems: "stretch",
    gap: 24,
  },
  cta: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "space-between",
    gap: 20,
  },
  headline: {
    margin: 0,
    font: "600 26px/32px var(--font-sans)",
    letterSpacing: "-0.02em",
    color: "var(--ink-900)",
  },
  headlineNum: {
    color: "var(--teal-700)",
  },
  subline: {
    margin: "10px 0 0",
    font: "400 14px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
  },
  divider: {
    width: 1,
    alignSelf: "stretch",
    background: "var(--border-1)",
    flexShrink: 0,
  },
  stats: {
    flexShrink: 0,
    width: 172,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    gap: 18,
  },
  statRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minWidth: 0,
  },
  statIconChip: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 36,
    height: 36,
    borderRadius: 10,
    flexShrink: 0,
    fontSize: 18,
  },
  statValue: {
    font: "600 18px/22px var(--font-sans)",
    color: "var(--ink-900)",
  },
  statLabel: {
    marginTop: 2,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
};
