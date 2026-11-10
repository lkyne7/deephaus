"use client";

import { useMemo, useState } from "react";
import type { ExamPlanDayDto } from "@deephaus/shared";
import {
  dateKeyInZone,
  minutesLabel,
  percentLabel,
  planDayLabel,
  planDayLevel,
  planTotals,
} from "./exam-helpers";
import "./exams.css";

const DOW_LABELS = ["S", "M", "T", "W", "T", "F", "S"] as const;

function localKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Plan days are plain calendar dates, so the grid is built in UTC to keep them fixed. */
function keyOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function dateOf(key: string): Date {
  return new Date(`${key}T12:00:00Z`);
}

function monthIndex(key: string): number {
  return Number(key.slice(0, 4)) * 12 + Number(key.slice(5, 7)) - 1;
}

function formatKey(key: string, options: Intl.DateTimeFormatOptions): string {
  return dateOf(key).toLocaleDateString(undefined, { ...options, timeZone: "UTC" });
}

type CalendarCell = { key: string; day: number; inMonth: boolean };

function monthCells(index: number): CalendarCell[] {
  const year = Math.floor(index / 12);
  const month = index % 12;
  const first = new Date(Date.UTC(year, month, 1));
  const last = new Date(Date.UTC(year, month + 1, 0));
  // Pad out to full Sunday-start weeks around the month.
  const cursor = new Date(first);
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());
  const cells: CalendarCell[] = [];
  while (cursor.getTime() <= last.getTime() || cells.length % 7 !== 0) {
    cells.push({
      key: keyOf(cursor),
      day: cursor.getUTCDate(),
      inMonth: cursor.getUTCMonth() === month,
    });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cells;
}

/** The day-by-day plan up to the exam: minutes, new cards and reviews for each day. */
export function ExamPlanCalendar({
  days,
  examAt,
  timezone,
}: {
  days: ExamPlanDayDto[];
  examAt: string;
  timezone: string;
}) {
  const byDate = useMemo(() => new Map(days.map((day) => [day.date, day])), [days]);
  const totals = useMemo(() => planTotals(days), [days]);
  const examKey = dateKeyInZone(new Date(examAt), timezone);
  const todayKey = localKey(new Date());
  const firstKey = days[0]?.date ?? todayKey;
  const firstMonth = monthIndex(firstKey);
  const lastMonth = Math.max(firstMonth, monthIndex(examKey));

  const [month, setMonth] = useState(firstMonth);
  const shownMonth = Math.min(lastMonth, Math.max(firstMonth, month));
  const [picked, setPicked] = useState<string | null>(null);
  const selectedKey = picked && byDate.has(picked) ? picked : firstKey;
  const selected = byDate.get(selectedKey) ?? null;

  const cells = useMemo(() => monthCells(shownMonth), [shownMonth]);
  const monthLabel = new Date(Date.UTC(Math.floor(shownMonth / 12), shownMonth % 12, 1)).toLocaleDateString(
    undefined,
    {
      month: "long",
      year: Math.floor(shownMonth / 12) === new Date().getFullYear() ? undefined : "numeric",
      timeZone: "UTC",
    },
  );

  if (days.length === 0) {
    return <p className="exam-none">No study is planned before this exam.</p>;
  }

  return (
    <section className="dh-surface exam-plan" aria-label="Day-by-day plan">
      <div className="exam-cal">
        <div className="exam-cal__head">
          <span className="exam-cal__month">{monthLabel}</span>
          <span className="dh-spacer" />
          <button
            type="button"
            className="exam-cal__nav"
            aria-label="Previous month"
            disabled={shownMonth <= firstMonth}
            onClick={() => setMonth(shownMonth - 1)}
          >
            <i className="ri-arrow-left-s-line" aria-hidden />
          </button>
          <button
            type="button"
            className="exam-cal__nav"
            aria-label="Next month"
            disabled={shownMonth >= lastMonth}
            onClick={() => setMonth(shownMonth + 1)}
          >
            <i className="ri-arrow-right-s-line" aria-hidden />
          </button>
        </div>

        <div className="exam-cal__grid">
          {DOW_LABELS.map((label, index) => (
            <span key={index} className="exam-cal__dow" aria-hidden>
              {label}
            </span>
          ))}
          {cells.map((cell) => {
            if (!cell.inMonth) return <span key={cell.key} aria-hidden />;
            const day = byDate.get(cell.key);
            const isExam = cell.key === examKey;
            const classes = [
              "exam-cal__day",
              cell.key < todayKey ? "is-past" : "",
              cell.key === todayKey ? "is-today" : "",
              day ? `is-level-${planDayLevel(day.minutes, totals.peak)}` : "",
              isExam ? "has-exam" : "",
              day && cell.key === selectedKey ? "is-selected" : "",
            ]
              .filter(Boolean)
              .join(" ");
            const dateText = formatKey(cell.key, { weekday: "short", month: "short", day: "numeric" });
            if (!day) {
              return (
                <span key={cell.key} className={classes} title={isExam ? `${dateText}: exam` : undefined}>
                  {cell.day}
                </span>
              );
            }
            const summary = `${dateText}: ${isExam ? "exam day, " : ""}${planDayLabel(day)}`;
            return (
              <button
                key={cell.key}
                type="button"
                className={classes}
                aria-pressed={cell.key === selectedKey}
                aria-label={summary}
                title={summary}
                onClick={() => setPicked(cell.key)}
              >
                {cell.day}
                {day.minutes > 0 ? <small>{day.minutes}m</small> : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="exam-plan__side">
        {selected ? (
          <div className="exam-plan__day" aria-live="polite">
            <div className="exam-plan__date">
              {formatKey(selected.date, { weekday: "long", month: "short", day: "numeric" })}
              {selected.date === examKey ? <span className="dh-pill">Exam day</span> : null}
            </div>
            <dl className="exam-kv-list">
              <div className="exam-kv">
                <dt>Time</dt>
                <dd>{selected.minutes > 0 ? minutesLabel(selected.minutes) : "Rest day"}</dd>
              </div>
              <div className="exam-kv">
                <dt>New cards</dt>
                <dd>{selected.new_cards.toLocaleString()}</dd>
              </div>
              <div className="exam-kv">
                <dt>Reviews</dt>
                <dd>{selected.reviews.toLocaleString()}</dd>
              </div>
              <div className="exam-kv">
                <dt>On track for, after this day</dt>
                <dd>{percentLabel(selected.recall_at_exam)}</dd>
              </div>
            </dl>
          </div>
        ) : null}
        <p className="exam-plan__total">
          {totals.studyDays.toLocaleString()} study {totals.studyDays === 1 ? "day" : "days"} ·{" "}
          {minutesLabel(totals.minutes)} in total · {totals.newCards.toLocaleString()} new{" "}
          {totals.newCards === 1 ? "card" : "cards"}
        </p>
        <p className="exam-field-hint">
          Gaps between reviews tighten as the exam nears, which favours exam day over long-term
          recall.
        </p>
      </div>
    </section>
  );
}
