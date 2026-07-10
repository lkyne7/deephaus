"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { PageHeaderSlot } from "@/components/page-header-context";
import { UntitledSearchInput, UntitledSelect } from "@/components/ui/untitled-controls";
import { apiFetch } from "@/lib/api/fetch";
import {
  getErrorMessage,
  normalizePlans,
  planDeadline,
  planReadiness,
  planTitle,
  readinessPercent,
  type CramPlan,
  type CramPlanStatus,
} from "./types";
import "./cram.css";

const STATUS_OPTIONS: Array<{ value: "all" | CramPlanStatus; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "paused", label: "Paused" },
  { value: "completed", label: "Completed" },
  { value: "archived", label: "Archived" },
];
const CRAM_BREADCRUMBS = [{ label: "Cram Plans" }];

export function CramPlansView() {
  const [plans, setPlans] = useState<CramPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CramPlanStatus>("all");

  const loadPlans = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch("/api/cram-plans", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load cram plans."));
      setPlans(normalizePlans(payload));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not load cram plans.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPlans();
  }, [loadPlans]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return plans.filter((plan) => {
      if (status !== "all" && plan.status !== status) return false;
      if (!normalizedQuery) return true;
      return (
        planTitle(plan).toLowerCase().includes(normalizedQuery) ||
        plan.status.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [plans, query, status]);

  return (
    <div className="cram-page">
      <PageHeaderSlot title="Cram Plans" breadcrumbs={CRAM_BREADCRUMBS} />
      <DashboardSectionHeader
        title="Cram Plans"
        icon="ri-timer-flash-line"
        count={plans.length}
        rightAction={
          <div className="cram-toolbar">
            <UntitledSearchInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search plans..."
              aria-label="Search cram plans"
              wrapperStyle={{ width: 260, maxWidth: "100%" }}
            />
            <UntitledSelect
              icon="ri-filter-3-line"
              value={status}
              onChange={(event) => setStatus(event.target.value as "all" | CramPlanStatus)}
              aria-label="Filter by status"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </UntitledSelect>
            <Link href="/cram/new" className="btn btn-primary btn-sm">
              <i className="ri-add-line" aria-hidden />
              New Cram Plan
            </Link>
          </div>
        }
      />

      {loading ? (
        <CramListLoading />
      ) : error ? (
        <div className="cram-state">
          <i className="ri-error-warning-line" aria-hidden />
          <h2>Couldn&apos;t load cram plans</h2>
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPlans()}>
            Try again
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div className="cram-state">
          <i className="ri-timer-flash-line" aria-hidden />
          <h2>{plans.length === 0 ? "No cram plans yet" : "No plans match those filters"}</h2>
          <p>
            {plans.length === 0
              ? "Build a focused, deadline-aware plan without changing your normal study schedule."
              : "Try a different search or status."}
          </p>
          {plans.length === 0 ? (
            <Link href="/cram/new" className="btn btn-primary btn-sm">
              New Cram Plan
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="cram-plan-grid">
          {filtered.map((plan) => (
            <PlanCard key={plan.id} plan={plan} />
          ))}
        </div>
      )}
    </div>
  );
}

function PlanCard({ plan }: { plan: CramPlan }) {
  const deadline = planDeadline(plan);
  const readiness = readinessPercent(planReadiness(plan));
  const cardCount =
    plan.card_count ??
    plan.item_count ??
    plan.forecast?.item_count ??
    plan.forecast?.total_cards;

  return (
    <Link href={`/cram/${plan.id}`} className="cram-plan-card">
      <div className="cram-plan-card-top">
        <span className={`chip ${statusChipClass(plan.status)}`}>
          <span className="chip-dot" />
          {plan.status}
        </span>
        <span className="cram-plan-card-date">
          {deadline ? formatDeadline(deadline, plan.deadline_timezone ?? plan.timezone) : "No deadline"}
        </span>
      </div>
      <h2 className="cram-plan-card-title">{planTitle(plan)}</h2>
      {readiness !== null ? (
        <div>
          <div className="cram-metric-head">
            <span className="cram-metric-label">Readiness</span>
            <span className="cram-plan-card-date">{readiness}%</span>
          </div>
          <div className="cram-progress" aria-label={`${readiness}% readiness`}>
            <span style={{ width: `${Math.min(100, Math.max(0, readiness))}%` }} />
          </div>
        </div>
      ) : null}
      <div className="cram-plan-card-meta">
        <div>
          <span>Cards</span>
          <strong>{typeof cardCount === "number" ? cardCount.toLocaleString() : "—"}</strong>
        </div>
        <div>
          <span>Daily budget</span>
          <strong>{plan.daily_minutes ? `${plan.daily_minutes} min` : "—"}</strong>
        </div>
      </div>
    </Link>
  );
}

function CramListLoading() {
  return (
    <div className="cram-plan-grid" aria-label="Loading cram plans">
      {[0, 1, 2].map((item) => (
        <div key={item} className="cram-plan-card" aria-hidden>
          <div className="skeleton-line" style={{ width: "38%", height: 22 }} />
          <div className="skeleton-line" style={{ width: "72%", height: 20 }} />
          <div className="skeleton-line" style={{ width: "100%", height: 6, marginTop: 16 }} />
          <div className="skeleton-line" style={{ width: "52%", height: 28, marginTop: "auto" }} />
        </div>
      ))}
    </div>
  );
}

function statusChipClass(status: CramPlanStatus): string {
  if (status === "active") return "chip-new";
  if (status === "paused") return "chip-due";
  if (status === "draft") return "chip-learning";
  return "chip-neutral";
}

function formatDeadline(iso: string, timezone?: string | null): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid deadline";
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
}
