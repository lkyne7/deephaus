"use client";

import { useMemo, useState } from "react";
import { toIsoDateKey } from "@/lib/fsrs/date-utils";

type Cell = { date: Date; inYear: boolean; future: boolean };

const REVIEW_COLORS = [
  "var(--ink-25)",
  "var(--brand-100)",
  "var(--brand-200)",
  "var(--brand-400)",
  "var(--brand-700)",
] as const;

const FORECAST_COLORS = [
  "var(--ink-25)",
  "var(--orange-100)",
  "var(--orange-200)",
  "var(--orange-300)",
  "var(--orange-500)",
] as const;

const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"] as const;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Always build a full Jan–Dec grid (including future days). */
function buildWeeks(year: number): Cell[][] {
  const jan1 = new Date(year, 0, 1);
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);

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
    if (cursor > yearEnd && cursor.getFullYear() > year) break;
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
  forecast?: Record<string, number>;
  loading?: boolean;
  fillHeight?: boolean;
  /** Scale SVG to container width (no horizontal scroll). */
  fitWidth?: boolean;
  /** Drop the outer card chrome (for use inside a modal). */
  embedded?: boolean;
  /** Open a larger heatmap overlay when the card is clicked. */
  onOpen?: () => void;
  title?: string;
  /** Optional year controls rendered in the header (e.g. prev/next). */
  yearControls?: React.ReactNode;
};

export function ReviewHeatmap({
  year,
  counts,
  forecast = {},
  loading = false,
  fillHeight = false,
  fitWidth = false,
  embedded = false,
  onOpen,
  title,
  yearControls,
}: Props) {
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const weeks = useMemo(() => buildWeeks(year), [year]);
  const todayKey = useMemo(() => toIsoDateKey(new Date()), []);

  const { maxReview, maxForecast, totalReviews, activeDays, totalForecast } = useMemo(() => {
    let maxR = 0;
    let maxF = 0;
    let totalR = 0;
    let active = 0;
    let totalF = 0;

    for (const count of Object.values(counts)) {
      totalR += count;
      if (count > 0) active += 1;
      if (count > maxR) maxR = count;
    }
    for (const count of Object.values(forecast)) {
      totalF += count;
      if (count > maxF) maxF = count;
    }
    return {
      maxReview: maxR,
      maxForecast: maxF,
      totalReviews: totalR,
      activeDays: active,
      totalForecast: totalF,
    };
  }, [counts, forecast]);

  const isCurrentYear = year === new Date().getFullYear();
  const summaryText = loading
    ? "Loading…"
    : [
        `${totalReviews.toLocaleString()} review${totalReviews === 1 ? "" : "s"}`,
        `${activeDays} active day${activeDays === 1 ? "" : "s"}`,
        totalForecast > 0
          ? `${totalForecast.toLocaleString()} projected`
          : null,
        isCurrentYear ? "this year" : null,
      ]
        .filter(Boolean)
        .join(" · ");

  const monthTicks = useMemo(() => {
    const ticks: Array<{ label: string; weekIndex: number }> = [];
    let lastMonth = -1;
    weeks.forEach((week, wi) => {
      const inYearDay = week.find((c) => c.inYear);
      if (!inYearDay) return;
      const month = inYearDay.date.getMonth();
      if (month !== lastMonth) {
        ticks.push({ label: MONTH_LABELS[month], weekIndex: wi });
        lastMonth = month;
      }
    });
    return ticks;
  }, [weeks]);

  const cellSize = fitWidth ? 11 : 12;
  const cellGap = fitWidth ? 2 : 3;
  const step = cellSize + cellGap;
  const labelWidth = 28;
  const gridWidth = weeks.length * step;
  const svgWidth = labelWidth + gridWidth + 8;
  const svgHeight = 7 * step + 24;

  const wrapStyle = embedded
    ? fillHeight
      ? { ...s.wrapEmbedded, ...s.wrapFillEmbedded }
      : s.wrapEmbedded
    : fillHeight
      ? { ...s.wrap, ...s.wrapFill }
      : s.wrap;

  return (
    <div
      className={onOpen ? "dh-hero-card" : undefined}
      style={{
        ...wrapStyle,
        cursor: onOpen ? "pointer" : undefined,
      }}
      onClick={onOpen}
      onKeyDown={
        onOpen
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpen();
              }
            }
          : undefined
      }
      role={onOpen ? "button" : undefined}
      tabIndex={onOpen ? 0 : undefined}
      aria-label={onOpen ? "Open full activity heatmap" : undefined}
    >
      <div style={s.header}>
        <div style={s.headerLeft}>
          {title ? <span style={s.title}>{title}</span> : null}
        </div>
        {yearControls ?? <span style={s.yearBadge}>{year}</span>}
      </div>

      <div
        style={
          fillHeight
            ? { position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }
            : { position: "relative", overflow: "hidden" }
        }
      >
        <svg
          width={fitWidth ? "100%" : svgWidth}
          height={fitWidth ? undefined : svgHeight}
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          preserveAspectRatio="xMinYMid meet"
          role="img"
          aria-label={`Review activity heatmap for ${year}`}
          style={fitWidth ? { display: "block", maxHeight: "100%" } : undefined}
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
              if (!cell.inYear) {
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
              const isFuture = cell.future;
              const isToday = key === todayKey;
              const count = isFuture ? (forecast[key] ?? 0) : (counts[key] ?? 0);
              const level = levelForCount(count, isFuture ? maxForecast : maxReview);
              const colors = isFuture ? FORECAST_COLORS : REVIEW_COLORS;
              const tip = isFuture
                ? `${count} card${count === 1 ? "" : "s"} due on ${formatTooltipDate(cell.date)}`
                : `${count} review${count === 1 ? "" : "s"} on ${formatTooltipDate(cell.date)}`;

              return (
                <rect
                  key={`${wi}-${di}`}
                  x={labelWidth + wi * step}
                  y={20 + di * step}
                  width={cellSize}
                  height={cellSize}
                  rx={2}
                  fill={colors[level]}
                  stroke={isToday ? "var(--ink-800)" : count > 0 ? "transparent" : "var(--border-1)"}
                  strokeWidth={isToday ? 1.5 : 0.5}
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

      <div style={s.footer}>
        <span style={s.summary}>{summaryText}</span>
        <div style={s.legendRow}>
          <div style={s.legend}>
            <span style={s.legendLabel}>Reviews</span>
            {REVIEW_COLORS.map((color, i) => (
              <span key={`r-${i}`} style={{ ...s.legendCell, background: color }} />
            ))}
          </div>
          <div style={s.legend}>
            <span style={s.legendLabel}>Projected</span>
            {FORECAST_COLORS.map((color, i) => (
              <span key={`f-${i}`} style={{ ...s.legendCell, background: color }} />
            ))}
          </div>
        </div>
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
    borderRadius: 14,
    padding: "20px 24px",
  },
  wrapEmbedded: {
    flex: 1,
    minWidth: 0,
    background: "transparent",
    border: "none",
    borderRadius: 0,
    padding: 0,
  },
  wrapFill: {
    height: "100%",
    minHeight: "var(--overview-panel-min-height)",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
  },
  wrapFillEmbedded: {
    height: "auto",
    minHeight: 0,
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
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    minWidth: 0,
  },
  title: {
    font: "600 16px/24px var(--font-sans)",
    color: "var(--ink-900)",
  },
  yearBadge: {
    flexShrink: 0,
    font: "500 12px/1 var(--font-sans)",
    color: "var(--fg-secondary)",
    background: "var(--bg-surface-2)",
    border: "1px solid var(--border-1)",
    borderRadius: 999,
    padding: "5px 12px",
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 12,
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
  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap",
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 4,
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
    zIndex: 200,
    pointerEvents: "none",
    background: "var(--ink-900)",
    color: "var(--white)",
    font: "500 12px/16px var(--font-sans)",
    padding: "6px 10px",
    borderRadius: 6,
    whiteSpace: "nowrap",
  },
};
