"use client";

import { useCallback, useState, type CSSProperties, type ReactNode } from "react";
import type { DayCount } from "@/lib/stats/insights";

type Tip = { x: number; y: number; value: string; label: string };

/** One floating readout per chart: value first, then what it describes. */
export function useChartTip() {
  const [tip, setTip] = useState<Tip | null>(null);

  const show = useCallback((element: Element, value: string, label: string) => {
    const rect = element.getBoundingClientRect();
    setTip({ x: rect.left + rect.width / 2, y: rect.top - 8, value, label });
  }, []);
  const hide = useCallback(() => setTip(null), []);

  const node = tip ? (
    <div className="dh-chart-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
      <b>{tip.value}</b>
      <span>{tip.label}</span>
    </div>
  ) : null;

  return { show, hide, node };
}

/** Screen-reader and no-hover route to the values a chart shows on hover. */
function ChartTable({ caption, rows }: { caption: string; rows: Array<[string, string]> }) {
  return (
    <table className="dh-chart-table">
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([label, value]) => (
          <tr key={label}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ChartCard({
  title,
  aside,
  className,
  children,
}: {
  title: string;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`dh-surface dh-chart${className ? ` ${className}` : ""}`}>
      <h3 className="dh-chart__title">
        {title}
        {aside ? <span className="dh-chart__aside">{aside}</span> : null}
      </h3>
      {children}
    </section>
  );
}

/** Thin columns on a hairline baseline, one per day or week. */
export function ColumnChart({
  caption,
  data,
  describe,
  unit,
  firstLabel,
  lastLabel,
  emptyLabel,
}: {
  caption: string;
  data: DayCount[];
  /** Tooltip label for one column, e.g. "Nov 5". */
  describe: (point: DayCount, index: number) => string;
  unit: string;
  firstLabel: string;
  lastLabel: string;
  emptyLabel: string;
}) {
  const { show, hide, node } = useChartTip();
  const max = data.reduce((peak, point) => Math.max(peak, point.count), 0);
  if (max === 0) return <p className="dh-chart__empty">{emptyLabel}</p>;

  const valueOf = (count: number) => `${count.toLocaleString()} ${unit}${count === 1 ? "" : "s"}`;

  return (
    <>
      <div className="dh-chart-cols" aria-hidden onPointerLeave={hide}>
        {data.map((point, index) => (
          <div
            key={point.date}
            className="dh-chart-col"
            onPointerEnter={(event) =>
              show(event.currentTarget.firstElementChild ?? event.currentTarget, valueOf(point.count), describe(point, index))
            }
          >
            <i style={{ height: point.count > 0 ? `max(${(point.count / max) * 100}%, 2px)` : 0 }} />
          </div>
        ))}
      </div>
      <div className="dh-chart-axis">
        <span>{firstLabel}</span>
        <span>{lastLabel}</span>
      </div>
      <ChartTable
        caption={caption}
        rows={data.map((point, index) => [describe(point, index), valueOf(point.count)])}
      />
      {node}
    </>
  );
}

export type ShareRow = { label: string; value: number; color: string };

/** Labelled horizontal bars. Each row names its mark, so colour is never alone. */
export function ShareChart({
  caption,
  rows,
  unit,
  emptyLabel,
}: {
  caption: string;
  rows: ShareRow[];
  unit: string;
  emptyLabel: string;
}) {
  const { show, hide, node } = useChartTip();
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  if (total === 0) return <p className="dh-chart__empty">{emptyLabel}</p>;

  const max = Math.max(...rows.map((row) => row.value));
  const percent = (value: number) => `${Math.round((value / total) * 100)}%`;
  const countOf = (value: number) => `${value.toLocaleString()} ${unit}${value === 1 ? "" : "s"}`;

  return (
    <>
      <div className="dh-hbars" aria-hidden onPointerLeave={hide}>
        {rows.map((row) => (
          <div
            key={row.label}
            className="dh-hbar"
            onPointerEnter={(event) =>
              show(
                event.currentTarget.querySelector("i") ?? event.currentTarget,
                countOf(row.value),
                `${row.label}, ${percent(row.value)}`,
              )
            }
          >
            <span>{row.label}</span>
            <div>
              <i
                style={
                  { width: `${(row.value / max) * 100}%`, background: row.color } as CSSProperties
                }
              />
            </div>
            <span>{percent(row.value)}</span>
          </div>
        ))}
      </div>
      <ChartTable
        caption={caption}
        rows={rows.map((row) => [row.label, `${countOf(row.value)}, ${percent(row.value)}`])}
      />
      {node}
    </>
  );
}
