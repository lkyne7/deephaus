"use client";

import { useMemo, useState, type PointerEvent } from "react";
import { computeHeatmapStats, formatDailyAverage } from "@deephaus/shared";
import { useChartTip } from "@/components/insights/insights-charts";
import { LoadErrorState } from "@/components/ui/load-error-state";
import { SkeletonBar } from "@/components/ui/skeleton-bars";
import { useReviewHeatmap } from "@/lib/client-cache/hooks/use-review-heatmap";
import { toIsoDateKey } from "@/lib/fsrs/date-utils";
import { buildYearWeeks, heatLevel, monthTicks } from "@/lib/stats/insights";

const MIN_YEAR_OFFSET = 10;
const MAX_YEAR_OFFSET = 2;
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", "Sun"];

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** Full-year activity: teal for reviews done, amber for reviews projected. */
export function ActivityHeatmap({ deckId }: { deckId: string | null }) {
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { data, error, isLoading, mutate } = useReviewHeatmap(year, deckId);
  const { show, hide, node } = useChartTip();

  const weeks = useMemo(() => buildYearWeeks(year), [year]);
  const ticks = useMemo(() => monthTicks(weeks), [weeks]);
  const todayKey = toIsoDateKey(new Date());
  const counts = data?.counts ?? {};
  const forecast = data?.forecast ?? {};
  const maxReview = Math.max(0, ...Object.values(counts));
  const maxForecast = Math.max(0, ...Object.values(forecast));
  const stats = useMemo(() => computeHeatmapStats(data?.counts ?? {}, year), [data, year]);

  function onPointerOver(event: PointerEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-value]");
    if (cell) show(cell, cell.dataset.value ?? "", cell.dataset.day ?? "");
    else hide();
  }

  return (
    <section className="dh-surface dh-chart dh-insights__activity">
      <div className="dh-chart__head">
        <h3 className="dh-chart__title dh-chart__title--flush">Activity</h3>
        <span className="dh-spacer" />
        <button
          type="button"
          className="dh-chart__nav"
          aria-label="Previous year"
          disabled={year <= currentYear - MIN_YEAR_OFFSET}
          onClick={() => setYear((value) => value - 1)}
        >
          <i className="ri-arrow-left-s-line" aria-hidden />
        </button>
        <span className="dh-chart__year">{year}</span>
        <button
          type="button"
          className="dh-chart__nav"
          aria-label="Next year"
          disabled={year >= currentYear + MAX_YEAR_OFFSET}
          onClick={() => setYear((value) => value + 1)}
        >
          <i className="ri-arrow-right-s-line" aria-hidden />
        </button>
      </div>

      {!data && error ? (
        <LoadErrorState label="your activity" onRetry={() => void mutate()} compact />
      ) : !data ? (
        <SkeletonBar height={126} radius={8} style={{ margin: "32px 0 40px" }} />
      ) : (
        <>
          <div className={`dh-heat${isLoading ? " is-loading" : ""}`} style={{ "--weeks": weeks.length } as React.CSSProperties}>
            <span />
            <div className="dh-heat__months" aria-hidden>
              {ticks.map((tick) => (
                <span key={tick.label} style={{ gridColumnStart: tick.week + 1 }}>
                  {tick.label}
                </span>
              ))}
            </div>
            <div className="dh-heat__days" aria-hidden>
              {DAY_LABELS.map((label, row) => (
                <span key={row}>{label}</span>
              ))}
            </div>
            <div
              className="dh-heat__grid"
              role="img"
              aria-label={`Review activity for ${year}: ${formatDailyAverage(stats.dailyAverage)} reviews a day, ${stats.longestStreak}-day longest streak`}
              onPointerOver={onPointerOver}
              onPointerLeave={hide}
            >
              {weeks.flatMap((week, weekIndex) =>
                week.map((cell, dayIndex) => {
                  const id = `${weekIndex}-${dayIndex}`;
                  if (!cell.inYear) return <i key={id} className="is-outside" />;
                  const key = toIsoDateKey(cell.date);
                  const projected = cell.future;
                  const count = projected ? (forecast[key] ?? 0) : (counts[key] ?? 0);
                  const level = heatLevel(count, projected ? maxForecast : maxReview);
                  const background =
                    projected && level > 0 ? `var(--projected-${level})` : `var(--heat-${level})`;
                  const value = projected
                    ? count > 0
                      ? `${plural(count, "review")} projected`
                      : "Nothing scheduled"
                    : count > 0
                      ? plural(count, "review")
                      : "No reviews";
                  return (
                    <i
                      key={id}
                      className={key === todayKey ? "is-today" : undefined}
                      style={{ background }}
                      data-value={value}
                      data-day={key === todayKey ? `Today, ${formatDay(cell.date)}` : formatDay(cell.date)}
                    />
                  );
                }),
              )}
            </div>
          </div>
          <div className="dh-heat__foot">
            <span>{formatDailyAverage(stats.dailyAverage)} reviews a day</span>
            <span>{Math.round(stats.daysLearnedPct * 100)}% days learned</span>
            <span>{stats.longestStreak}-day longest streak</span>
            <span className="dh-spacer" />
            <span className="dh-heat__legend">
              Reviews
              {[1, 2, 3, 4].map((step) => (
                <u key={step} style={{ background: `var(--heat-${step})` }} />
              ))}
            </span>
            <span className="dh-heat__legend">
              Projected
              {[1, 2, 3, 4].map((step) => (
                <u key={step} style={{ background: `var(--projected-${step})` }} />
              ))}
            </span>
          </div>
        </>
      )}
      {node}
    </section>
  );
}
