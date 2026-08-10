"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  forecastDaily,
  normalizeToday,
  planDeadline,
  planTitle,
  type CramPlan,
} from "./types";
import "./cram.css";

const PLANNING_STATUSES = new Set(["draft", "active", "paused"]);
const DOW_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Heat backgrounds for projected review load (level 0–4). */
const HEAT_BACKGROUNDS = [
  "var(--white)",
  "color-mix(in srgb, var(--orange-500) 10%, var(--white))",
  "color-mix(in srgb, var(--orange-500) 22%, var(--white))",
  "color-mix(in srgb, var(--orange-500) 38%, var(--white))",
  "color-mix(in srgb, var(--orange-500) 56%, var(--white))",
] as const;

function localKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Calendar day (YYYY-MM-DD) of an instant in the plan's own timezone. */
function deadlineKey(iso: string, timezone?: string | null): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return localKey(date);
  }
}

function heatLevel(count: number, max: number): number {
  if (count <= 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

/** Digest of today's remaining cram work across active plans. */
export function CramTodayStrip({ plans }: { plans: CramPlan[] }) {
  const sessions = useMemo(
    () =>
      plans
        .filter((plan) => plan.status === "active")
        .flatMap((plan) => {
          const today = normalizeToday(plan.today);
          if (!today) return [];
          return [{ plan, today }];
        }),
    [plans],
  );

  if (sessions.length === 0) return null;

  const pending = sessions.filter(({ today }) => (today.reviewsRemaining ?? 0) > 0);

  return (
    <div className="cram-today-strip" role="status" aria-label="Today's cram sessions">
      <div className="cram-today-strip-head">
        <i className="ri-flashlight-fill" aria-hidden />
        {pending.length === 0
          ? "All cram sessions done for today"
          : `${pending.length} cram session${pending.length === 1 ? "" : "s"} remaining today`}
      </div>
      {sessions.map(({ plan, today }) => {
        const remaining = today.reviewsRemaining ?? 0;
        const minutes =
          today.estimatedSecondsPerReview !== null && remaining > 0
            ? Math.max(1, Math.round((remaining * today.estimatedSecondsPerReview) / 60))
            : null;
        return (
          <div key={plan.id} className="cram-today-row">
            <span className="cram-today-row-name">{planTitle(plan)}</span>
            {remaining > 0 ? (
              <>
                <span className="cram-today-row-meta">
                  {remaining.toLocaleString()} review{remaining === 1 ? "" : "s"} left
                  {minutes !== null ? ` · ~${minutes} min` : ""}
                </span>
                <Link href={`/cram/${plan.id}/study`} className="btn btn-primary btn-sm">
                  <i className="ri-play-line" aria-hidden />
                  Study
                </Link>
              </>
            ) : (
              <span className="cram-today-row-done">
                <i className="ri-checkbox-circle-fill" aria-hidden />
                Done for today
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

type CalendarCell = {
  key: string;
  date: Date;
  inRange: boolean;
  isPast: boolean;
  isToday: boolean;
};

/** Calendar of upcoming test deadlines and projected daily cram reviews. */
export function CramCalendar({ plans }: { plans: CramPlan[] }) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  /** Offset in months from the current month (0 = this month). */
  const [monthOffset, setMonthOffset] = useState(0);

  const { deadlines, projected } = useMemo(() => {
    const deadlineMap = new Map<string, string[]>();
    const projectedMap = new Map<string, number>();

    for (const plan of plans) {
      if (!PLANNING_STATUSES.has(plan.status)) continue;

      const deadline = planDeadline(plan);
      if (deadline) {
        const key = deadlineKey(deadline, plan.deadline_timezone ?? plan.timezone);
        if (key) {
          deadlineMap.set(key, [...(deadlineMap.get(key) ?? []), planTitle(plan)]);
        }
      }

      for (const day of forecastDaily(plan.forecast)) {
        if (day.totalReviews <= 0) continue;
        projectedMap.set(day.date, (projectedMap.get(day.date) ?? 0) + day.totalReviews);
      }
    }

    return { deadlines: deadlineMap, projected: projectedMap };
  }, [plans]);

  const { weeks, monthLabel } = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayKey = localKey(today);

    const monthStart = new Date(today.getFullYear(), today.getMonth() + monthOffset, 1);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);

    // Pad out to full Monday-start weeks around the month.
    const start = new Date(monthStart);
    const dow = start.getDay();
    start.setDate(start.getDate() + (dow === 0 ? -6 : 1 - dow));

    const rows: CalendarCell[][] = [];
    const cursor = new Date(start);
    while (cursor.getTime() <= monthEnd.getTime() || rows.length === 0) {
      const row: CalendarCell[] = [];
      for (let i = 0; i < 7; i++) {
        const date = new Date(cursor);
        const key = localKey(date);
        row.push({
          key,
          date,
          inRange: date.getMonth() === monthStart.getMonth(),
          isPast: key < todayKey,
          isToday: key === todayKey,
        });
        cursor.setDate(cursor.getDate() + 1);
      }
      rows.push(row);
    }

    return {
      weeks: rows,
      monthLabel: monthStart.toLocaleDateString(undefined, {
        month: "long",
        year: "numeric",
      }),
    };
  }, [monthOffset]);

  const maxProjected = useMemo(() => {
    let max = 0;
    for (const count of projected.values()) {
      if (count > max) max = count;
    }
    return max;
  }, [projected]);

  if (deadlines.size === 0 && projected.size === 0) return null;

  return (
    <section className="cram-panel cram-calendar" aria-label="Upcoming tests and projected reviews">
      <div className="cram-calendar-head">
        <h2 className="cram-calendar-title">Upcoming tests &amp; projected reviews</h2>
        <div className="cram-calendar-nav" role="group" aria-label="Calendar month">
          <button
            type="button"
            className="cram-calendar-nav-btn"
            aria-label="Previous month"
            onClick={() => setMonthOffset((offset) => offset - 1)}
          >
            <i className="ri-arrow-left-s-line" aria-hidden />
          </button>
          <button
            type="button"
            className="cram-calendar-nav-label"
            onClick={() => setMonthOffset(0)}
            title="Back to current month"
            disabled={monthOffset === 0}
          >
            {monthLabel}
          </button>
          <button
            type="button"
            className="cram-calendar-nav-btn"
            aria-label="Next month"
            onClick={() => setMonthOffset((offset) => offset + 1)}
          >
            <i className="ri-arrow-right-s-line" aria-hidden />
          </button>
        </div>
        <div className="cram-calendar-legend">
          <span className="cram-calendar-legend-item">
            <span className="cram-calendar-legend-deadline">
              <i className="ri-flag-2-fill" aria-hidden />
            </span>
            Test deadline
          </span>
          <span className="cram-calendar-legend-item">
            Fewer
            {HEAT_BACKGROUNDS.map((background, i) => (
              <span
                key={i}
                className="cram-calendar-legend-swatch"
                style={{ background, border: i === 0 ? "1px solid var(--border-1)" : undefined }}
              />
            ))}
            More reviews
          </span>
        </div>
      </div>

      <div className="cram-calendar-grid">
        {DOW_LABELS.map((label) => (
          <div key={label} className="cram-calendar-dow">
            {label}
          </div>
        ))}
        {weeks.flat().map((cell) => {
          const muted = !cell.inRange;
          const count = cell.isPast || muted ? 0 : (projected.get(cell.key) ?? 0);
          const cellDeadlines = muted ? [] : (deadlines.get(cell.key) ?? []);
          const level = cell.isPast || muted ? 0 : heatLevel(count, maxProjected);
          const classes = [
            "cram-calendar-cell",
            muted ? "is-outside" : "",
            cell.isPast ? "is-past" : "",
            cell.isToday ? "is-today" : "",
            cellDeadlines.length > 0 ? "has-deadline" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const dayLabel = String(cell.date.getDate());
          const tipLines = [
            cell.date.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
            ...cellDeadlines.map((name) => `Test: ${name}`),
            !cell.isPast && count > 0
              ? `${count.toLocaleString()} projected review${count === 1 ? "" : "s"}`
              : null,
          ].filter(Boolean) as string[];

          return (
            <div
              key={cell.key}
              className={classes}
              style={{ background: level > 0 ? HEAT_BACKGROUNDS[level] : undefined }}
              onMouseEnter={(event) => {
                if (tipLines.length <= 1) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setTooltip({
                  x: rect.left + rect.width / 2,
                  y: rect.top - 8,
                  text: tipLines.join("\n"),
                });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <span className="cram-calendar-day">{dayLabel}</span>
              {cellDeadlines.length > 0 ? (
                <span className="cram-calendar-deadline" title={cellDeadlines.join(", ")}>
                  <i className="ri-flag-2-fill" aria-hidden />
                </span>
              ) : null}
              {!cell.isPast && count > 0 ? (
                <span className="cram-calendar-count">{count.toLocaleString()}</span>
              ) : null}
            </div>
          );
        })}
      </div>

      {tooltip ? (
        <div
          className="cram-calendar-tooltip"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
          role="tooltip"
        >
          {tooltip.text}
        </div>
      ) : null}
    </section>
  );
}
