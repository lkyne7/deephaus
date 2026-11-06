"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
import { apiFetch } from "@/lib/api/fetch";
import { CramDetailSkeleton } from "./cram-skeletons";
import {
  daysLeftLabel,
  formatDeadlineLong,
  formatDeadlineShort,
  getErrorMessage,
  isRecord,
  normalizeToday,
  planCardCount,
  planDeadline,
  planStatusLabel,
  planStatusPillClass,
  planTimezone,
  planTitle,
  previewRuns,
  readinessHero,
  readinessPercent,
  todayProgress,
  type CramForecast,
  type CramItemPreview,
  type CramPlan,
  type CramToday,
  type PlanAction,
} from "./types";
import "./cram.css";

type DetailData = {
  plan: CramPlan;
  forecast: CramForecast | null;
  itemsPreview: CramItemPreview[];
  today: CramToday | null;
};

const COLLAPSED_CARDS = 4;

export function CramPlanDetail({ planId }: { planId: string }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<PlanAction | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);

  const loadPlan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/cram-plans/${planId}`, { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load this cram plan."));
      if (!isRecord(payload) || !isRecord(payload.plan) || typeof payload.plan.id !== "string") {
        throw new Error("The cram plan response was incomplete.");
      }
      setData({
        plan: payload.plan as CramPlan,
        forecast: isRecord(payload.forecast) ? (payload.forecast as CramForecast) : null,
        itemsPreview: Array.isArray(payload.items_preview)
          ? payload.items_preview.filter(isRecord).map((item) => item as CramItemPreview)
          : [],
        today: normalizeToday(payload.today),
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load this cram plan.");
    } finally {
      setLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const runAction = useCallback(
    async (action: PlanAction) => {
      setActioning(action);
      setError(null);
      try {
        const response = await apiFetch(`/api/cram-plans/${planId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const payload: unknown = await response.json().catch(() => null);
        if (!response.ok) throw new Error(getErrorMessage(payload, `Could not ${action} this plan.`));
        if (isRecord(payload) && isRecord(payload.plan)) {
          setData((current) =>
            current
              ? {
                  ...current,
                  plan: payload.plan as CramPlan,
                  forecast: isRecord(payload.forecast)
                    ? (payload.forecast as CramForecast)
                    : current.forecast,
                  today: normalizeToday(payload.today) ?? current.today,
                }
              : current,
          );
        } else {
          await loadPlan();
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : `Could not ${action} this plan.`);
      } finally {
        setActioning(null);
      }
    },
    [loadPlan, planId],
  );

  const renamePlan = useCallback(
    async (name: string) => {
      const response = await apiFetch(`/api/cram-plans/${planId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not rename this plan."));
      if (isRecord(payload) && isRecord(payload.plan)) {
        setData((current) =>
          current ? { ...current, plan: payload.plan as CramPlan } : current,
        );
      } else {
        await loadPlan();
      }
    },
    [loadPlan, planId],
  );

  return (
    <div className="dh-page dh-page--narrow">
      {loading ? (
        <CramDetailSkeleton />
      ) : error && !data ? (
        <div className="dh-empty">
          <h2>Couldn&apos;t load this plan</h2>
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPlan()}>
            Try again
          </button>
        </div>
      ) : data ? (
        <>
          <div className="dh-crumb">
            <Link href="/cram">Cram</Link>
            <i className="ri-arrow-right-s-line" aria-hidden />
          </div>
          <PlanHeader
            plan={data.plan}
            today={data.today}
            actioning={actioning}
            onAction={(action) =>
              action === "archive" ? setArchiveOpen(true) : void runAction(action)
            }
            onRename={() => setRenameOpen(true)}
          />
          {error ? <p className="cram-field-error" role="alert">{error}</p> : null}
          <ReadinessPanel plan={data.plan} forecast={data.forecast} />
          <PlanMetrics plan={data.plan} forecast={data.forecast} today={data.today} />
          <PlanCards items={data.itemsPreview} total={planCardCount(data.plan)} />
          {renameOpen ? (
            <RenameCramPlanDialog
              currentName={planTitle(data.plan)}
              onClose={() => setRenameOpen(false)}
              onSave={renamePlan}
            />
          ) : null}
          {archiveOpen ? (
            <AnimatedModal title="Archive this plan?" onClose={() => setArchiveOpen(false)} maxWidth={420} closeOnEscape>
              <p className="cram-dialog-copy">It moves to Finished. You can unarchive it at any time.</p>
              <div className="cram-dialog-actions">
                <button type="button" className="btn btn-ghost" onClick={() => setArchiveOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    setArchiveOpen(false);
                    void runAction("archive");
                  }}
                >
                  Archive
                </button>
              </div>
            </AnimatedModal>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function PlanHeader({
  plan,
  today,
  actioning,
  onAction,
  onRename,
}: {
  plan: CramPlan;
  today: CramToday | null;
  actioning: PlanAction | null;
  onAction: (action: PlanAction) => void;
  onRename: () => void;
}) {
  const deadline = planDeadline(plan);
  const timezone = planTimezone(plan);
  const finished = plan.status === "completed" || plan.status === "archived";
  const active = plan.status === "active";
  const lead = leadAction(plan.status);
  const remaining = active ? (today?.reviewsRemaining ?? 0) : 0;
  const studyLabel =
    remaining > 0
      ? `Study ${remaining.toLocaleString()} ${remaining === 1 ? "card" : "cards"}`
      : "Study";
  const studyClass = active ? "btn btn-primary" : "btn btn-secondary";

  return (
    <>
      <div className="dh-page-head cram-detail-head">
        <h1 className="dh-title">{planTitle(plan)}</h1>
        <span className={planStatusPillClass(plan.status)}>
          {active ? <span className="cram-dot" aria-hidden /> : null}
          {planStatusLabel(plan.status)}
        </span>
        <span className="dh-spacer" />
        {lead ? (
          <button
            type="button"
            className={lead === "unarchive" ? "btn btn-secondary" : "btn btn-primary"}
            onClick={() => onAction(lead)}
            disabled={actioning !== null}
          >
            {actioning === lead ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
            {actionLabel(lead)}
          </button>
        ) : null}
        {active ? (
          <Link href={`/cram/${plan.id}/study`} className={studyClass}>
            {studyLabel}
          </Link>
        ) : (
          <button
            type="button"
            className={studyClass}
            disabled
            title="Start or resume this plan before studying"
          >
            Study
          </button>
        )}
        <PlanMenu plan={plan} actioning={actioning} onAction={onAction} onRename={onRename} />
      </div>
      <p className="cram-detail-when">
        {deadline
          ? [
              formatDeadlineLong(deadline, { timezone, hasTime: plan.deadline_has_time }),
              finished ? null : daysLeftLabel(deadline, timezone),
            ]
              .filter(Boolean)
              .join(" · ")
          : "No deadline set"}
      </p>
    </>
  );
}

function PlanMenu({
  plan,
  actioning,
  onAction,
  onRename,
}: {
  plan: CramPlan;
  actioning: PlanAction | null;
  onAction: (action: PlanAction) => void;
  onRename: () => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const actions = menuActions(plan.status);

  return (
    <div ref={rootRef} className="cram-menu-root">
      <button
        type="button"
        className="cram-icon-btn"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <i className="ri-more-line" aria-hidden />
      </button>
      {open ? (
        <div className="cram-menu" role="menu" aria-label="Plan actions">
          <button
            type="button"
            role="menuitem"
            className="dh-menu-row"
            disabled={actioning !== null}
            onClick={() => {
              setOpen(false);
              onRename();
            }}
          >
            <i className="ri-pencil-line" aria-hidden />
            Rename
          </button>
          {actions.length > 0 ? <div className="dh-menu-sep" /> : null}
          {actions.map((action) => (
            <button
              key={action}
              type="button"
              role="menuitem"
              className="dh-menu-row"
              disabled={actioning !== null}
              onClick={() => {
                setOpen(false);
                onAction(action);
              }}
            >
              <i className={actionIcon(action)} aria-hidden />
              {actionLabel(action)}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReadinessPanel({ plan, forecast }: { plan: CramPlan; forecast: CramForecast | null }) {
  const deadline = planDeadline(plan);
  const timezone = planTimezone(plan);
  const current = readinessPercent(plan.readiness);
  const projected =
    typeof forecast?.readiness === "number" ? readinessPercent(forecast.readiness) : null;
  const target = readinessPercent(plan.target_retention ?? plan.desired_retention ?? plan.retention);
  const hero = readinessHero({
    status: plan.status,
    current,
    projected,
    target,
    dailyMinutes: plan.daily_minutes ?? null,
    readyItems: forecast?.readiness_detail?.ready_items ?? null,
    totalItems: forecast?.readiness_detail?.total_items ?? null,
    deadlinePassed: deadline ? new Date(deadline).getTime() <= Date.now() : false,
  });

  return (
    <section className="dh-surface cram-hero">
      <div className="cram-hero__top">
        <div>
          <div className="cram-hero-num">{hero.value === null ? "—" : `${hero.value}%`}</div>
          <div
            className="cram-muted cram-hero__label"
            title="What you'd recall at your deadline if you stopped studying today"
          >
            {hero.label}
          </div>
        </div>
        <div className="cram-hero__copy">
          <div className="cram-hero__headline">{hero.headline}</div>
          {hero.detail ? <div className="cram-muted">{hero.detail}</div> : null}
        </div>
      </div>
      {hero.showChart && current !== null && projected !== null && deadline ? (
        <>
          <ReadinessChart
            current={current}
            projected={projected}
            target={target}
            deadlineLabel={formatDeadlineShort(deadline, {
              timezone,
              hasTime: plan.deadline_has_time,
            })}
          />
          <p className="cram-chart-note">
            Today&apos;s estimate and the deadline projection. Past readiness isn&apos;t recorded, so
            there&apos;s no history to plot.
          </p>
        </>
      ) : null}
    </section>
  );
}

const CHART = { width: 640, height: 190, left: 30, right: 40, top: 20, bottom: 24 };

function ReadinessChart({
  current,
  projected,
  target,
  deadlineLabel,
}: {
  current: number;
  projected: number;
  target: number | null;
  deadlineLabel: string;
}) {
  const [hover, setHover] = useState<"today" | "deadline" | null>(null);
  const lowest = Math.min(current, projected, target ?? 100);
  const domainLow = lowest >= 40 ? Math.min(Math.floor(lowest / 20) * 20, 80) : 0;
  const step = domainLow >= 60 ? 10 : domainLow > 0 ? 20 : 25;
  const ticks = Array.from(
    { length: (100 - domainLow) / step + 1 },
    (_, index) => domainLow + index * step,
  );
  const x0 = CHART.left + 8;
  const x1 = CHART.width - CHART.right;
  const y = (value: number) =>
    CHART.height -
    CHART.bottom -
    ((value - domainLow) * (CHART.height - CHART.bottom - CHART.top)) / (100 - domainLow);
  const summary = `Readiness ${current}% today, projected ${projected}% by ${deadlineLabel}${
    target === null ? "" : `, against a ${target}% target`
  }.`;

  const tip =
    hover === "today"
      ? { x: x0, y: y(current), edge: "start", text: `Today: ${current}% ready` }
      : hover === "deadline"
        ? { x: x1, y: y(projected), edge: "end", text: `${deadlineLabel}: ${projected}% projected` }
        : null;

  return (
    <div
      className="cram-chart"
      onPointerMove={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        setHover((event.clientX - rect.left) / rect.width < 0.5 ? "today" : "deadline");
      }}
      onPointerLeave={() => setHover(null)}
    >
      <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} role="img" aria-label={summary}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line className="cram-chart__grid" x1={CHART.left} x2={x1} y1={y(tick)} y2={y(tick)} />
            <text className="cram-chart__text" x={CHART.left - 6} y={y(tick) + 4} textAnchor="end">
              {tick}
            </text>
          </g>
        ))}
        {target !== null ? (
          <>
            <line className="cram-chart__target" x1={CHART.left} x2={x1} y1={y(target)} y2={y(target)} />
            <text className="cram-chart__text" x={x1 + 4} y={y(target) + 4}>
              Target
            </text>
          </>
        ) : null}
        <line
          className="cram-chart__line"
          x1={x0}
          x2={x1}
          y1={y(current)}
          y2={y(projected)}
        />
        {tip ? (
          <line
            className="cram-chart__grid"
            x1={tip.x}
            x2={tip.x}
            y1={CHART.top}
            y2={CHART.height - CHART.bottom}
          />
        ) : null}
        <circle className="cram-chart__dot" cx={x0} cy={y(current)} r={4.5} />
        <circle className="cram-chart__dot cram-chart__dot--open" cx={x1} cy={y(projected)} r={4.5} />
        <text className="cram-chart__value" x={x0} y={y(current) - 11} textAnchor="middle">
          {current}%
        </text>
        <text className="cram-chart__value" x={x1} y={y(projected) - 11} textAnchor="middle">
          {projected}%
        </text>
        <text className="cram-chart__text" x={x0} y={CHART.height - 4} textAnchor="middle">
          Today
        </text>
        <text className="cram-chart__text" x={x1} y={CHART.height - 4} textAnchor="middle">
          {deadlineLabel}
        </text>
      </svg>
      {tip ? (
        <div
          className={`cram-tip cram-tip--chart cram-tip--${tip.edge}`}
          style={{
            left: `${(tip.x / CHART.width) * 100}%`,
            top: `${(tip.y / CHART.height) * 100}%`,
          }}
          role="tooltip"
        >
          {tip.text}
        </div>
      ) : null}
    </div>
  );
}

function PlanMetrics({
  plan,
  forecast,
  today,
}: {
  plan: CramPlan;
  forecast: CramForecast | null;
  today: CramToday | null;
}) {
  const cards = planCardCount(plan) ?? forecast?.cards_selected ?? null;
  const retention = readinessPercent(plan.target_retention ?? plan.desired_retention ?? plan.retention);
  const metrics = [
    { label: "Cards", value: cards === null ? "—" : cards.toLocaleString() },
    { label: "Today", value: plan.status === "active" ? todayProgress(today) : "—" },
    { label: "Daily budget", value: plan.daily_minutes ? `${plan.daily_minutes} min` : "—" },
    { label: "Target retention", value: retention === null ? "—" : `${retention}%` },
  ];

  return (
    <section className="dh-surface cram-stats" aria-label="Plan details">
      {metrics.map((metric) => (
        <div key={metric.label}>
          <b>{metric.value}</b>
          <span>{metric.label}</span>
        </div>
      ))}
    </section>
  );
}

function PlanCards({ items, total }: { items: CramItemPreview[]; total: number | null }) {
  const [expanded, setExpanded] = useState(false);
  const canExpand = items.length > COLLAPSED_CARDS;
  const visible = expanded ? items : items.slice(0, COLLAPSED_CARDS);
  const hiddenInPreview = total !== null && total > items.length;

  return (
    <>
      <div className="dh-section-label">
        Cards in this plan
        <span className="dh-spacer" />
        {canExpand ? (
          <button
            type="button"
            className="cram-disclosure"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "Show fewer" : `Show ${items.length}`}
            <i className={expanded ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"} aria-hidden />
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="cram-none">No card preview available.</p>
      ) : (
        <div>
          {visible.map((item, index) => {
            const runs = previewRuns(item.front);
            return (
              <div key={item.item_id ?? item.id ?? item.card_id ?? index} className="cram-card-row">
                <div className="cram-card-row__front">
                  {runs.length > 0
                    ? runs.map((run, runIndex) =>
                        run.strong ? <strong key={runIndex}>{run.text}</strong> : run.text,
                      )
                    : `Card ${index + 1}`}
                </div>
                <span className="cram-card-row__deck">{item.deck_name ?? "Selected card"}</span>
              </div>
            );
          })}
          {expanded && hiddenInPreview ? (
            <p className="cram-none">
              Showing the first {items.length} of {total?.toLocaleString()} cards.
            </p>
          ) : null}
        </div>
      )}
    </>
  );
}

function RenameCramPlanDialog({
  currentName,
  onClose,
  onSave,
}: {
  currentName: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const inputId = useId();
  const [value, setValue] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = value.trim();
    if (!trimmed) {
      setError("Enter a plan name.");
      return;
    }
    if (trimmed === currentName.trim()) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not rename this plan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AnimatedModal title="Rename plan" onClose={saving ? () => undefined : onClose} maxWidth={420}>
      <div className="field">
        <label className="field-label" htmlFor={inputId}>
          Plan name
        </label>
        <input
          id={inputId}
          className="input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          maxLength={120}
          autoFocus
          disabled={saving}
        />
      </div>
      {error ? (
        <p className="cram-field-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="cram-dialog-actions">
        <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={saving || !value.trim()}
        >
          {saving ? <i className="ri-loader-4-line icon-spin" aria-hidden /> : null}
          Save
        </button>
      </div>
    </AnimatedModal>
  );
}

/** The one action worth a button in the header; everything else is in the menu. */
function leadAction(status: CramPlan["status"]): PlanAction | null {
  if (status === "draft") return "start";
  if (status === "paused") return "resume";
  if (status === "archived") return "unarchive";
  return null;
}

function menuActions(status: CramPlan["status"]): PlanAction[] {
  if (status === "draft") return ["archive"];
  if (status === "active") return ["pause", "complete", "archive"];
  if (status === "paused") return ["complete", "archive"];
  if (status === "completed") return ["archive"];
  return [];
}

function actionLabel(action: PlanAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function actionIcon(action: PlanAction): string {
  if (action === "pause") return "ri-pause-line";
  if (action === "complete") return "ri-check-line";
  return "ri-archive-line";
}
