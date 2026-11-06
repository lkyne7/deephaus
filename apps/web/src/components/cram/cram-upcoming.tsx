"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  forecastDaily,
  planDeadline,
  planTitle,
  planTimezone,
  summarizeToday,
  type CramPlan,
} from "./types";
import "./cram.css";

const PLANNING_STATUSES = new Set(["draft", "active", "paused"]);
const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

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

/** Digest of today's remaining cram work across active plans. */
export function CramTodayStrip({ plans }: { plans: CramPlan[] }) {
  const today = useMemo(() => summarizeToday(plans), [plans]);
  if (today.sessions === 0) return null;

  const across = today.pendingPlans > 1 ? ` across ${today.pendingPlans} plans` : "";
  const startsWith =
    today.pendingPlans > 1 && today.next ? ` · starts with ${planTitle(today.next)}` : "";

  return (
    <section className="dh-surface cram-today" aria-label="Today's cram sessions">
      <div className="cram-today__text">
        <div className="cram-today__title">
          {today.next
            ? `${today.remaining.toLocaleString()} cram ${today.remaining === 1 ? "card" : "cards"} left today`
            : "All cram sessions done for today"}
        </div>
        <div className="cram-today__meta">
          {today.next
            ? `About ${today.minutes} ${today.minutes === 1 ? "minute" : "minutes"}${across}${startsWith}`
            : `Nothing left across ${today.sessions} active ${today.sessions === 1 ? "plan" : "plans"}`}
        </div>
      </div>
      {today.next ? (
        <Link href={`/cram/${today.next.id}/study`} className="btn btn-primary">
          Start session
        </Link>
      ) : null}
    </section>
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
        const key = deadlineKey(deadline, planTimezone(plan));
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

    // Pad out to full Sunday-start weeks around the month.
    const start = new Date(monthStart);
    start.setDate(start.getDate() - start.getDay());

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
        year: monthStart.getFullYear() === today.getFullYear() ? undefined : "numeric",
      }),
    };
  }, [monthOffset]);

  return (
    <section className="dh-surface cram-cal" aria-label="Upcoming tests and projected reviews">
      <div className="cram-cal__head">
        <button
          type="button"
          className="cram-cal__month"
          onClick={() => setMonthOffset(0)}
          title="Back to current month"
          disabled={monthOffset === 0}
        >
          {monthLabel}
        </button>
        <span className="dh-spacer" />
        <button
          type="button"
          className="cram-cal__nav"
          aria-label="Previous month"
          onClick={() => setMonthOffset((offset) => offset - 1)}
        >
          <i className="ri-arrow-left-s-line" aria-hidden />
        </button>
        <button
          type="button"
          className="cram-cal__nav"
          aria-label="Next month"
          onClick={() => setMonthOffset((offset) => offset + 1)}
        >
          <i className="ri-arrow-right-s-line" aria-hidden />
        </button>
      </div>

      <div className="cram-cal__grid">
        {DOW_LABELS.map((label, index) => (
          <span key={index} className="cram-cal__dow">
            {label}
          </span>
        ))}
        {weeks.flat().map((cell) => {
          if (!cell.inRange) return <span key={cell.key} aria-hidden />;
          const count = cell.isPast ? 0 : (projected.get(cell.key) ?? 0);
          const cellDeadlines = deadlines.get(cell.key) ?? [];
          const classes = [
            "cram-cal__day",
            cell.isPast ? "is-past" : "",
            cell.isToday ? "is-today" : "",
            count > 0 ? "has-reviews" : "",
            cellDeadlines.length > 0 ? "has-deadline" : "",
          ]
            .filter(Boolean)
            .join(" ");
          const tipLines = [
            cell.date.toLocaleDateString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
            }),
            ...cellDeadlines.map((name) => `Test: ${name}`),
            count > 0 ? `${count.toLocaleString()} projected review${count === 1 ? "" : "s"}` : null,
          ].filter(Boolean) as string[];
          const hasTip = tipLines.length > 1;
          const showTip = (target: HTMLElement) => {
            if (!hasTip) return;
            const rect = target.getBoundingClientRect();
            setTooltip({
              x: rect.left + rect.width / 2,
              y: rect.top - 8,
              text: tipLines.join("\n"),
            });
          };

          return (
            <span
              key={cell.key}
              className={classes}
              tabIndex={hasTip ? 0 : undefined}
              aria-label={hasTip ? tipLines.join(", ") : undefined}
              onMouseEnter={(event) => showTip(event.currentTarget)}
              onMouseLeave={() => setTooltip(null)}
              onFocus={(event) => showTip(event.currentTarget)}
              onBlur={() => setTooltip(null)}
            >
              {cell.date.getDate()}
            </span>
          );
        })}
      </div>

      {tooltip ? (
        <div
          className="cram-tip"
          style={{ left: tooltip.x, top: tooltip.y, transform: "translate(-50%, -100%)" }}
          role="tooltip"
        >
          {tooltip.text}
        </div>
      ) : null}
    </section>
  );
}
