"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { apiFetch } from "@/lib/api/fetch";
import { OptionMenu } from "@/components/ui/option-menu";

export type ForecastDay = { date: string; review: number; new: number; total: number };

export type ForecastData = {
  inputs: { new_cards_remaining: number };
  days: ForecastDay[];
  summary: {
    totalReviews: number;
    totalNew: number;
    averagePerDay: number;
    peak: { date: string; count: number };
  };
};

const MIN_DAYS = 7;
const MAX_DAYS = 365;
const DEFAULT_DAYS = 90;

export function clampForecastDays(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, n));
}

export function formatForecastDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function useDeckForecast(
  projectId: string,
  opts: { days: number; newPerDay: number; retention: number; maxPerDay?: number | "" },
) {
  const { days, newPerDay, retention, maxPerDay } = opts;
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    const timer = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          days: String(days),
          newPerDay: String(Math.max(0, newPerDay)),
          retention: String(Math.min(0.99, Math.max(0.7, retention))),
        });
        if (maxPerDay !== "" && maxPerDay !== undefined && maxPerDay > 0) {
          params.set("maxPerDay", String(maxPerDay));
        }
        const res = await apiFetch(`/api/decks/${projectId}/simulate?${params}`, {
          credentials: "include",
        });
        const json = await res.json();
        if (seq !== requestSeq.current) return;
        if (!res.ok) throw new Error(json?.error ?? "Simulation failed");
        setData(json as ForecastData);
      } catch (e) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : "Simulation failed");
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [projectId, days, newPerDay, retention, maxPerDay]);

  return { data, loading, error };
}

function ForecastChart({
  days,
  height,
  stacked,
  label,
}: {
  days: ForecastDay[];
  height: number;
  /** Split each day into reviews and new cards; otherwise one series of totals. */
  stacked: boolean;
  label: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => days.reduce((m, day) => Math.max(m, day.total), 0), [days]);
  const scale = max > 0 ? height / max : 0;
  const active = hover === null ? null : days[hover];
  const dense = days.length > 120;

  if (days.length === 0) return <div className="dhd-chart__empty" style={{ height }} />;

  return (
    <div className="dhd-chart">
      <div
        className={`dhd-chart__plot${dense ? " dhd-chart__plot--dense" : ""}`}
        style={{ height }}
        role="img"
        aria-label={label}
        onMouseLeave={() => setHover(null)}
      >
        {days.map((day, index) => {
          const parts = stacked
            ? ([["review", day.review], ["new", day.new]] as const)
            : ([["review", day.total]] as const);
          return (
            <div
              key={day.date}
              className={`dhd-chart__col${hover === index ? " is-active" : ""}`}
              onMouseEnter={() => setHover(index)}
            >
              {parts.map(([kind, value]) =>
                value > 0 ? (
                  <i
                    key={kind}
                    className={`dhd-chart__bar dhd-chart__bar--${kind}`}
                    style={{ height: Math.max(2, value * scale) }}
                  />
                ) : null,
              )}
            </div>
          );
        })}
        {active && hover !== null ? (
          <div
            className="dhd-chart__tip"
            style={{ left: `clamp(70px, ${((hover + 0.5) / days.length) * 100}%, calc(100% - 70px))` }}
          >
            <b>{formatForecastDate(active.date)}</b>
            <span>
              {active.total.toLocaleString()} {active.total === 1 ? "card" : "cards"}
            </span>
            {stacked && active.total > 0 ? (
              <small>
                {active.review.toLocaleString()} review, {active.new.toLocaleString()} new
              </small>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="dhd-chart__axis">
        <span>Today</span>
        <span>{formatForecastDate(days[days.length - 1]!.date)}</span>
      </div>
    </div>
  );
}

function ForecastLegend() {
  return (
    <div className="dhd-legend">
      <span>
        <u className="dhd-chart__bar--review" />
        Review cards
      </span>
      <span>
        <u className="dhd-chart__bar--new" />
        New cards
      </span>
    </div>
  );
}

/** The rail's small preview, on the deck's saved settings. */
export function DeckForecastMini({
  projectId,
  newPerDay,
  retention,
}: {
  projectId: string;
  newPerDay: number;
  retention: number;
}) {
  const { data, error } = useDeckForecast(projectId, { days: 30, newPerDay, retention });
  if (error) return <p className="dhd-muted">Couldn&apos;t load the forecast.</p>;
  return (
    <ForecastChart
      days={data?.days ?? []}
      height={52}
      stacked={false}
      label="Cards due each day for the next 30 days"
    />
  );
}

const PANEL_PERIODS = [
  { value: "30", label: "30 days" },
  { value: "90", label: "90 days" },
  { value: "180", label: "180 days" },
  { value: "365", label: "1 year" },
];

/** Study settings panel: shows what the values being edited would do. */
export function DeckForecastPanel({
  projectId,
  newPerDay,
  retention,
}: {
  projectId: string;
  newPerDay: number;
  retention: number;
}) {
  const [period, setPeriod] = useState("90");
  const { data, loading, error } = useDeckForecast(projectId, {
    days: Number(period),
    newPerDay,
    retention,
  });

  return (
    <section>
      <div className="dhd-panel-row">
        <b>Review forecast</b>
        <span className="dh-spacer" />
        <OptionMenu
          aria-label="Time period"
          value={period}
          options={PANEL_PERIODS}
          triggerClassName="dhd-period"
          onChange={setPeriod}
        />
      </div>
      {error ? (
        <div className="notice notice-error">{error}</div>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
          <ForecastChart
            days={data?.days ?? []}
            height={72}
            stacked
            label={`Projected cards per day for the next ${period} days`}
          />
          <ForecastLegend />
          {data ? (
            <dl className="dhd-kv-grid">
              <Kv label="Total reviews" value={(data.summary.totalReviews + data.summary.totalNew).toLocaleString()} />
              <Kv label="Average/day" value={data.summary.averagePerDay.toLocaleString()} />
              <Kv label="Busiest day" value={data.summary.peak.count.toLocaleString()} />
              <Kv label="New cards left" value={data.inputs.new_cards_remaining.toLocaleString()} />
            </dl>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div className="dhd-kv">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

/** Forecast tab: the full simulator with its own what-if inputs. */
export function DeckForecastTab({
  projectId,
  defaultNewPerDay,
  defaultRetention,
}: {
  projectId: string;
  defaultNewPerDay: number;
  defaultRetention: number;
}) {
  const [daysInput, setDaysInput] = useState(String(DEFAULT_DAYS));
  const [newPerDay, setNewPerDay] = useState(defaultNewPerDay);
  const [retentionPct, setRetentionPct] = useState(Math.round(defaultRetention * 100));
  const [maxPerDay, setMaxPerDay] = useState<number | "">("");
  const days = clampForecastDays(daysInput);
  const { data, loading, error } = useDeckForecast(projectId, {
    days,
    newPerDay,
    retention: retentionPct / 100,
    maxPerDay,
  });

  return (
    <section className="dhd-forecast">
      <p className="dhd-muted">
        Simulated with your FSRS parameters. Projected daily workload from cards already
        scheduled plus new cards you&apos;ll introduce.
      </p>
      <div className="dhd-forecast__controls">
        <label>
          <span>Time period (days)</span>
          <input
            className="input"
            type="number"
            min={MIN_DAYS}
            max={MAX_DAYS}
            value={daysInput}
            onChange={(e) => setDaysInput(e.target.value.replace(/[^0-9]/g, ""))}
            onBlur={() => setDaysInput(String(clampForecastDays(daysInput)))}
          />
        </label>
        <label>
          <span>New cards/day</span>
          <input
            className="input"
            type="number"
            min={0}
            max={500}
            value={newPerDay}
            onChange={(e) => setNewPerDay(Math.max(0, Number(e.target.value) || 0))}
          />
        </label>
        <label>
          <span>Desired retention %</span>
          <input
            className="input"
            type="number"
            min={70}
            max={99}
            value={retentionPct}
            onChange={(e) => setRetentionPct(Math.min(99, Math.max(70, Number(e.target.value) || 90)))}
          />
        </label>
        <label>
          <span>Max reviews/day</span>
          <input
            className="input"
            type="number"
            min={0}
            max={5000}
            placeholder="No limit"
            value={maxPerDay}
            onChange={(e) => {
              const raw = e.target.value;
              setMaxPerDay(raw === "" ? "" : Math.max(0, Number(raw) || 0));
            }}
          />
        </label>
      </div>

      {error ? (
        <div className="notice notice-error">{error}</div>
      ) : (
        <div style={{ opacity: loading ? 0.55 : 1, transition: "opacity .2s" }}>
          <ForecastChart
            days={data?.days ?? []}
            height={180}
            stacked
            label={`Projected cards per day for the next ${days} days`}
          />
          <ForecastLegend />
          {data ? (
            <div className="dhd-tiles">
              <Tile label="Total reviews" value={(data.summary.totalReviews + data.summary.totalNew).toLocaleString()} />
              <Tile label="Average/day" value={data.summary.averagePerDay.toLocaleString()} />
              <Tile
                label="Busiest day"
                value={`${data.summary.peak.count.toLocaleString()} on ${formatForecastDate(data.summary.peak.date)}`}
              />
              <Tile label="New cards left" value={data.inputs.new_cards_remaining.toLocaleString()} />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <b>{value}</b>
      <span>{label}</span>
    </div>
  );
}
