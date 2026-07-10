"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PageHeaderSlot } from "@/components/page-header-context";
import { apiFetch } from "@/lib/api/fetch";
import {
  getErrorMessage,
  isRecord,
  planDeadline,
  planReadiness,
  planTitle,
  readinessPercent,
  type CramForecast,
  type CramItemPreview,
  type CramPlan,
  type PlanAction,
} from "./types";
import "./cram.css";

type DetailData = {
  plan: CramPlan;
  forecast: CramForecast | null;
  itemsPreview: CramItemPreview[];
};
const CRAM_PLANS_BACK = { href: "/cram", label: "Cram Plans" };

export function CramPlanDetail({ planId }: { planId: string }) {
  const [data, setData] = useState<DetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actioning, setActioning] = useState<PlanAction | null>(null);

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
      if (action === "archive" && !window.confirm("Archive this cram plan?")) return;
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

  const headerTitle = data ? planTitle(data.plan) : "Cram Plan";

  return (
    <div className="cram-page">
      <PageHeaderSlot title={headerTitle} back={CRAM_PLANS_BACK} />
      <div className="cram-page-narrow">
        {loading ? (
          <DetailLoading />
        ) : error && !data ? (
          <div className="cram-state">
            <i className="ri-error-warning-line" aria-hidden />
            <h2>Couldn&apos;t load this plan</h2>
            <p>{error}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPlan()}>
              Try again
            </button>
          </div>
        ) : data ? (
          <div className="cram-detail">
            <PlanHero plan={data.plan} actioning={actioning} onAction={runAction} />
            {error ? <div className="cram-error">{error}</div> : null}
            <PlanMetrics plan={data.plan} forecast={data.forecast} />
            <ItemsPreview items={data.itemsPreview} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PlanHero({
  plan,
  actioning,
  onAction,
}: {
  plan: CramPlan;
  actioning: PlanAction | null;
  onAction: (action: PlanAction) => Promise<void>;
}) {
  const deadline = planDeadline(plan);
  const actions = availableActions(plan.status);

  return (
    <section className="cram-panel cram-detail-hero">
      <div>
        <div className="cram-detail-title-row">
          <h1 className="cram-detail-title">{planTitle(plan)}</h1>
          <span className={`chip ${statusChipClass(plan.status)}`}>
            <span className="chip-dot" />
            {plan.status}
          </span>
        </div>
        <p className="cram-detail-subtitle">
          {deadline
            ? `Deadline ${formatDeadline(deadline, plan.deadline_timezone ?? plan.timezone)}`
            : "No deadline set"}
          {plan.deadline_timezone || plan.timezone
            ? ` · ${(plan.deadline_timezone ?? plan.timezone ?? "").replaceAll("_", " ")}`
            : ""}
        </p>
      </div>
      <div className="cram-detail-actions">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            className={action === "archive" ? "btn btn-ghost btn-sm" : "btn btn-secondary btn-sm"}
            onClick={() => void onAction(action)}
            disabled={actioning !== null}
          >
            {actioning === action ? (
              <i className="ri-loader-4-line icon-spin" aria-hidden />
            ) : (
              <i className={actionIcon(action)} aria-hidden />
            )}
            {actionLabel(action)}
          </button>
        ))}
        {plan.status === "active" ? (
          <Link href={`/cram/${plan.id}/study`} className="btn btn-primary btn-sm">
            <i className="ri-play-line" aria-hidden />
            Study
          </Link>
        ) : (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled
            title="Start or resume this plan before studying"
          >
            <i className="ri-play-line" aria-hidden />
            Study
          </button>
        )}
      </div>
    </section>
  );
}

function PlanMetrics({ plan, forecast }: { plan: CramPlan; forecast: CramForecast | null }) {
  const readiness = readinessPercent(planReadiness(plan, forecast));
  const cards =
    plan.card_count ??
    plan.item_count ??
    forecast?.item_count ??
    forecast?.total_cards ??
    forecast?.cards_selected;
  const days = forecast?.days_remaining ?? deadlineDays(planDeadline(plan));
  const retention = plan.target_retention ?? plan.desired_retention ?? plan.retention;
  const dailyReviews =
    forecast?.daily_review_capacity ??
    forecast?.reviews_per_day ??
    forecast?.cards_due_today ??
    forecast?.daily_budget;

  const metrics = useMemo(
    () => [
      { label: "Readiness", value: readiness === null ? "—" : `${readiness}%` },
      { label: "Cards", value: numberLabel(cards) },
      { label: "Days remaining", value: numberLabel(days) },
      { label: "Daily budget", value: plan.daily_minutes ? `${plan.daily_minutes} min` : "—" },
      {
        label: "Target retention",
        value: typeof retention === "number" ? `${Math.round(retention * 100)}%` : "—",
      },
      { label: "Planned today", value: numberLabel(dailyReviews) },
    ],
    [cards, dailyReviews, days, plan.daily_minutes, readiness, retention],
  );

  return (
    <section className="cram-panel cram-metrics" aria-label="Plan forecast">
      {metrics.map((metric) => (
        <div key={metric.label} className="cram-metric">
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          {metric.label === "Readiness" && readiness !== null ? (
            <div className="cram-progress" style={{ marginTop: 10 }}>
              <span style={{ width: `${Math.min(100, Math.max(0, readiness))}%` }} />
            </div>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function ItemsPreview({ items }: { items: CramItemPreview[] }) {
  return (
    <section className="cram-panel cram-preview-list">
      <h2>Cards in this plan</h2>
      {items.length === 0 ? (
        <div className="cram-state" style={{ minHeight: 180, border: 0, borderRadius: 0 }}>
          <i className="ri-file-list-3-line" aria-hidden />
          <h2>No card preview available</h2>
          <p>The plan can still be started when its selected cards are available.</p>
        </div>
      ) : (
        items.map((item, index) => (
          <div key={item.item_id ?? item.id ?? item.card_id ?? index} className="cram-preview-row">
            <i className="ri-file-list-3-line" aria-hidden />
            <div className="cram-preview-row-main">
              <span className="cram-preview-row-title">
                {plainPreview(item.front) || `Card ${index + 1}`}
              </span>
              <span className="cram-preview-row-meta">
                {[item.deck_name, item.tags?.join(", ")].filter(Boolean).join(" · ") || "Selected card"}
              </span>
            </div>
          </div>
        ))
      )}
    </section>
  );
}

function DetailLoading() {
  return (
    <div className="cram-detail" aria-label="Loading cram plan">
      <div className="cram-panel" style={{ height: 120 }} />
      <div className="cram-panel" style={{ height: 220 }} />
      <div className="cram-panel" style={{ height: 220 }} />
    </div>
  );
}

function availableActions(status: CramPlan["status"]): PlanAction[] {
  if (status === "draft") return ["start", "archive"];
  if (status === "active") return ["pause", "complete", "archive"];
  if (status === "paused") return ["resume", "complete", "archive"];
  if (status === "completed") return ["archive"];
  return [];
}

function actionLabel(action: PlanAction): string {
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function actionIcon(action: PlanAction): string {
  if (action === "start" || action === "resume") return "ri-play-line";
  if (action === "pause") return "ri-pause-line";
  if (action === "complete") return "ri-check-line";
  return "ri-archive-line";
}

function statusChipClass(status: CramPlan["status"]): string {
  if (status === "active") return "chip-new";
  if (status === "paused") return "chip-due";
  if (status === "draft") return "chip-learning";
  return "chip-neutral";
}

function formatDeadline(iso: string, timezone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "at an invalid date";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
}

function deadlineDays(deadline: string | null): number | null {
  if (!deadline) return null;
  const timestamp = new Date(deadline).getTime();
  if (Number.isNaN(timestamp)) return null;
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 86_400_000));
}

function numberLabel(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString() : "—";
}

function plainPreview(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}
