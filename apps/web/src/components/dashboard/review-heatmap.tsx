"use client";

import { useMemo, useState } from "react";
import { toIsoDateKey } from "@/lib/fsrs/date-utils";

type Cell = { date: Date; inYear: boolean; future: boolean };

const LEVEL_COLORS = [
  "var(--ink-25)",
  "var(--brand-100)",
  "var(--brand-200)",
  "var(--brand-400)",
  "var(--brand-700)",
] as const;

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function buildWeeks(year: number): Cell[][] {
  const jan1 = new Date(year, 0, 1);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const end =
    year === today.getFullYear() ? today : new Date(year, 11, 31, 23, 59, 59, 999);

  const start = new Date(jan1);
  const dow = start.getDay();
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  start.setDate(start.getDate() + mondayOffset);

  const weeks: Cell[][] = [];
  const cursor = new Date(start);

  while (weeks.length < 54) {
    const week: Cell[] = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(cursor);
      const inYear = date.getFullYear() === year;
      const future = date > today;
      week.push({ date, inYear, future });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(week);
    if (cursor > end && cursor.getFullYear() > year) break;
  }

  return weeks;
}

function levelForCount(count: number, max: number): number {
  if (count === 0) return 0;
  if (max <= 1) return 4;
  const ratio = count / max;
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

function formatTooltipDate(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type Props = {
  year: number;
  counts: Record<string, number>;
  availableYears: number[];
  onYearChange?: (year: number) => void;
  loading?: boolean;
  fillHeight?: boolean;
  onOpenStats?: () => void;
};

export function ReviewHeatmap({
  year,
  counts,
  availableYears,
  onYearChange,
  loading = false,
  fillHeight = false,
  onOpenStats,
}: Props) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const weeks = useMemo(() => buildWeeks(year), [year]);

  const { maxCount, totalReviews, activeDays, spanDays } = useMemo(() => {
    let max = 0;
    let total = 0;
    let active = 0;
    const jan1 = new Date(year, 0, 1);
    const today = new Date();
    const end = year === today.getFullYear() ? today : new Date(year, 11, 31);
    const span = Math.max(1, Math.ceil((end.getTime() - jan1.getTime()) / 86_400_000) + 1);

    for (const [key, count] of Object.entries(counts)) {
      total += count;
      if (count > 0) active += 1;
      if (count > max) max = count;
    }
    return { maxCount: max, totalReviews: total, activeDays: active, spanDays: span };
  }, [counts, year]);

  const monthTicks = useMemo(() => {
    const ticks: Array<{ label: string; weekIndex: number }> = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const inYearDay = week.find((c) => c.inYear && !c.future);
      if (!inYearDay) return;
      const month = inYearDay.date.getMonth();
      if (month !== lastMonth) {
        ticks.push({ label: MONTH_LABELS[month], weekIndex: wi });
        lastMonth = month;
      }
    });
    return ticks;
  }, [weeks]);

  const cellSize = 12;
  const cellGap = 3;
  const step = cellSize + cellGap;
  const labelWidth = 28;
  const gridWidth = weeks.length * step;

  return (
    <div
      style={{
        ...(fillHeight ? { ...s.wrap, ...s.wrapFill } : s.wrap),
        cursor: onOpenStats ? "pointer" : undefined,
      }}
      onClick={(e) => {
        if (!onOpenStats) return;
        if ((e.target as HTMLElement).closest("select, option")) return;
        onOpenStats();
      }}
    >
      <div style={s.header}>
        <div style={s.headerLeft}>
          {onYearChange && availableYears.length > 1 ? (
            <select
              value={year}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => onYearChange(Number(e.target.value))}
              style={s.yearSelect}
              aria-label="Heatmap year"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          ) : (
            <span style={s.yearLabel}>{year}</span>
          )}
          <span style={s.summary}>
            {loading
              ? "Loading…"
              : `${totalReviews.toLocaleString()} review${totalReviews === 1 ? "" : "s"} over ${spanDays} days · ${activeDays} active day${activeDays === 1 ? "" : "s"}`}
          </span>
        </div>
      </div>

      <div
        style={
          fillHeight
            ? { position: "relative", overflowX: "auto", paddingBottom: 4, flex: 1, minHeight: 0 }
            : { position: "relative", overflowX: "auto", paddingBottom: 4 }
        }
      >
        <svg
          width={labelWidth + gridWidth + 8}
          height={7 * step + 24}
          role="img"
          aria-label={`Review activity heatmap for ${year}`}
        >
          {monthTicks.map((tick) => (
            <text
              key={`${tick.label}-${tick.weekIndex}`}
              x={labelWidth + tick.weekIndex * step}
              y={10}
              style={s.monthLabel}
            >
              {tick.label}
            </text>
          ))}

          {DAY_LABELS.map((label, row) =>
            label ? (
              <text key={label} x={0} y={24 + row * step + cellSize - 1} style={s.dayLabel}>
                {label}
              </text>
            ) : null,
          )}

          {weeks.map((week, wi) =>
            week.map((cell, di) => {
              if (!cell.inYear || cell.future) {
                return (
                  <rect
                    key={`${wi}-${di}`}
                    x={labelWidth + wi * step}
                    y={20 + di * step}
                    width={cellSize}
                    height={cellSize}
                    rx={2}
                    fill="transparent"
                  />
                );
              }
              const key = toIsoDateKey(cell.date);
              const count = counts[key] ?? 0;
              const level = levelForCount(count, maxCount);
              const reviewLabel = count === 1 ? "review" : "reviews";
              const tip = `${count} ${reviewLabel} on ${formatTooltipDate(cell.date)}`;

              return (
                <rect
                  key={`${wi}-${di}`}
                  x={labelWidth + wi * step}
                  y={20 + di * step}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill={LEVEL_COLORS[level]}
                  stroke={count > 0 ? "transparent" : "var(--border-1)"}
                  strokeWidth={0.5}
                  style={{ cursor: "default" }}
                  onMouseEnter={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    setTooltip({
                      x: rect.left + rect.width / 2,
                      y: rect.top - 8,
                      text: tip,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <title>{tip}</title>
                </rect>
              );
            }),
          )}
        </svg>

        {tooltip && (
          <div
            style={{
              ...s.tooltip,
              left: tooltip.x,
              top: tooltip.y,
              transform: "translate(-50%, -100%)",
            }}
            role="tooltip"
          >
            {tooltip.text}
          </div>
        )}
      </div>

      <div style={s.legend}>
        <span style={s.legendLabel}>Less</span>
        {LEVEL_COLORS.map((color, i) => (
          <span key={i} style={{ ...s.legendCell, background: color }} />
        ))}
        <span style={s.legendLabel}>More</span>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    minWidth: 0,
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 12,
    padding: "20px 24px",
  },
  wrapFill: {
    height: "100%",
    minHeight: "var(--overview-panel-min-height)",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 12,
  },
  headerLeft: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    flexWrap: "wrap",
  },
  yearLabel: {
    font: "600 18px/24px var(--font-sans)",
    color: "var(--ink-900)",
  },
  yearSelect: {
    font: "600 16px/24px var(--font-sans)",
    color: "var(--ink-900)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    padding: "4px 8px",
    background: "var(--white)",
  },
  summary: {
    font: "400 13px/20px var(--font-sans)",
    color: "var(--fg-4)",
  },
  monthLabel: {
    font: "400 11px/1 var(--font-sans)",
    fill: "var(--fg-4)",
  },
  dayLabel: {
    font: "400 11px/1 var(--font-sans)",
    fill: "var(--fg-4)",
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginTop: 12,
  },
  legendLabel: {
    font: "400 11px/1 var(--font-sans)",
    color: "var(--fg-4)",
    marginRight: 4,
  },
  legendCell: {
    width: 12,
    height: 12,
    borderRadius: 2,
    display: "inline-block",
  },
  tooltip: {
    position: "fixed",
    zIndex: 50,
    pointerEvents: "none",
    background: "var(--ink-900)",
    color: "var(--white)",
    font: "500 12px/16px var(--font-sans)",
    padding: "6px 10px",
    borderRadius: 6,
    whiteSpace: "nowrap",
  },
};
