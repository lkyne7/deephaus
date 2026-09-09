"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AnimatedModal } from "@/components/motion/animated-modal";
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
  const [renameOpen, setRenameOpen] = useState(false);

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
            <PlanHero
              plan={data.plan}
              actioning={actioning}
              onAction={runAction}
              onRename={() => setRenameOpen(true)}
            />
            {renameOpen ? (
              <RenameCramPlanDialog
                currentName={planTitle(data.plan)}
                onClose={() => setRenameOpen(false)}
                onSave={renamePlan}
              />
            ) : null}
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
  onRename,
}: {
  plan: CramPlan;
  actioning: PlanAction | null;
  onAction: (action: PlanAction) => Promise<void>;
  onRename: () => void;
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
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onRename}
          disabled={actioning !== null}
        >
          <i className="ri-pencil-line" aria-hidden />
          Rename
        </button>
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
      { label: "Projected readiness", value: readiness === null ? "—" : `${readiness}%` },
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
          {metric.label === "Projected readiness" && readiness !== null ? (
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
    <div className="cram-detail" aria-busy aria-label="Loading cram plan">
      <div className="cram-panel" style={{ padding: 20 }}>
        <div className="skeleton-line" style={{ width: "34%", height: 22 }} />
        <div className="skeleton-line" style={{ width: "58%", height: 12, marginTop: 12 }} />
        <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
          <div className="skeleton-line" style={{ width: 96, height: 30, borderRadius: 8 }} />
          <div className="skeleton-line" style={{ width: 96, height: 30, borderRadius: 8 }} />
        </div>
      </div>
      <div className="cram-panel" style={{ padding: 20 }}>
        <div className="skeleton-line" style={{ width: "40%", height: 16 }} />
        <div className="skeleton-line" style={{ width: "100%", height: 12, marginTop: 14 }} />
        <div className="skeleton-line" style={{ width: "92%", height: 12, marginTop: 8 }} />
        <div className="skeleton-line" style={{ width: "64%", height: 12, marginTop: 8 }} />
        <div className="skeleton-line" style={{ width: "100%", height: 90, marginTop: 16, borderRadius: 8 }} />
      </div>
      <div className="cram-panel" style={{ padding: 20 }}>
        <div className="skeleton-line" style={{ width: "36%", height: 16 }} />
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="skeleton-line" style={{ width: "100%", height: 40, marginTop: 10, borderRadius: 8 }} />
        ))}
      </div>
    </div>
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
    <AnimatedModal title="Rename Cram Plan" onClose={saving ? () => undefined : onClose} maxWidth={420}>
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
        <div className="cram-error" role="alert" style={{ marginTop: 12 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
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

function availableActions(status: CramPlan["status"]): PlanAction[] {
  if (status === "draft") return ["start", "archive"];
  if (status === "active") return ["pause", "complete", "archive"];
  if (status === "paused") return ["resume", "complete", "archive"];
  if (status === "completed") return ["archive"];
  if (status === "archived") return ["unarchive"];
  return [];
}

function actionLabel(action: PlanAction): string {
  if (action === "unarchive") return "Unarchive";
  return action.charAt(0).toUpperCase() + action.slice(1);
}

function actionIcon(action: PlanAction): string {
  if (action === "start" || action === "resume") return "ri-play-line";
  if (action === "pause") return "ri-pause-line";
  if (action === "complete") return "ri-check-line";
  if (action === "unarchive") return "ri-inbox-unarchive-line";
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
