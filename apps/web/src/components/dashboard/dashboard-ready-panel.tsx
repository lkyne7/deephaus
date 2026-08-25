"use client";

import Link from "next/link";
import useSWR from "swr";
import { cacheKeys } from "@/lib/client-cache/keys";

/** Rough per-card review pace used only for the "About N minutes" estimate. */
const SECONDS_PER_CARD = 9;

const ACTIVE_CRAM_PLANS_KEY = `${cacheKeys.cramPlans}?status=active`;

type Props = {
  cardsReady: number;
  reviewedToday: number;
  dueNow: number;
  streak: number;
  retentionPct: number | null;
  /** Number of decks the user owns; 0 switches to the first-run "get started" state. */
  deckCount?: number;
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

function ReadyPanelShell({
  clickable,
  onClick,
  children,
}: {
  clickable: boolean;
  onClick?: (e: React.MouseEvent<HTMLElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <aside
      className={`dh-ready-panel${clickable ? " dh-hero-card" : ""}`}
      onClick={onClick}
    >
      <div className="dh-ready-row">{children}</div>
    </aside>
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
  deckCount,
  onOpenStats,
}: Props) {
  const { data: activeCram } = useSWR<{ plans?: unknown[] }>(ACTIVE_CRAM_PLANS_KEY);
  const hasActiveCram =
    Array.isArray(activeCram?.plans) && activeCram.plans.length > 0;
  // No active plans → create flow; otherwise open the plans list.
  // While loading, prefer /cram so existing sessions aren't skipped.
  const cramHref = activeCram && !hasActiveCram ? "/cram/new" : "/cram";

  const isFirstRun = deckCount === 0;
  const hasWork = cardsReady > 0;
  const retentionDisplay =
    retentionPct !== null ? `${Math.round(retentionPct * 100)}%` : "—";

  const subline = isFirstRun
    ? "Paste notes, upload a PDF, or drop in a link — DeepHaus turns it into flashcards."
    : hasWork
      ? `About ${estimateDuration(cardsReady)}${
          reviewedToday > 0 ? ` · ${reviewedToday} reviewed already` : ""
        }`
      : reviewedToday > 0
        ? `All caught up · ${reviewedToday} reviewed today`
        : "Nothing due right now — add or study a deck to get going";

  return (
    <ReadyPanelShell
      clickable={Boolean(onOpenStats)}
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
      <div className="dh-ready-cta">
        <div>
          <h2 className="dh-ready-headline">
            {isFirstRun ? (
              "Welcome to DeepHaus"
            ) : hasWork ? (
              <>
                <span style={s.headlineNum}>{cardsReady.toLocaleString()}</span> cards ready for
                today
              </>
            ) : (
              "You're all caught up"
            )}
          </h2>
          <p className="dh-ready-subline">{subline}</p>
        </div>

        <div className="dh-ready-actions">
          {isFirstRun ? (
            <>
              <Link href="/create" className="btn btn-primary">
                Create your first deck
                <i className="ri-arrow-right-line" aria-hidden />
              </Link>
              <Link href="/community" className="btn btn-brand">
                <i className="ri-earth-line" aria-hidden />
                Browse Community
              </Link>
            </>
          ) : (
            <>
              <Link href="/decks" className="btn btn-primary">
                {hasWork ? "Study Now" : "Study"}
                <i className="ri-arrow-right-line" aria-hidden />
              </Link>
              <Link href={cramHref} className="btn btn-brand">
                <i className="ri-flashlight-line" aria-hidden />
                Cram
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="dh-ready-divider" />

      <div className="dh-ready-stats">
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
    </ReadyPanelShell>
  );
}

const s: Record<string, React.CSSProperties> = {
  headlineNum: {
    color: "var(--teal-700)",
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
