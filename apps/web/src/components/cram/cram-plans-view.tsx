"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UntitledMenuSelect, UntitledSearchInput } from "@/components/ui/untitled-controls";
import { apiFetch } from "@/lib/api/fetch";
import { sweepPreviewDrafts, trackedPreviewDrafts } from "./cram-preview-draft";
import { CramListSkeleton } from "./cram-skeletons";
import { CramCalendar, CramTodayStrip } from "./cram-upcoming";
import {
  daysLeftLabel,
  formatDeadlineShort,
  getErrorMessage,
  groupPlans,
  normalizePlans,
  normalizeToday,
  planCardCount,
  planDeadline,
  planReadiness,
  planStatusLabel,
  planStatusPillClass,
  planTimezone,
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

/** Session cache so returning to the page renders instantly while refreshing. */
let cachedPlans: CramPlan[] | null = null;

export function CramPlansView() {
  const [plans, setPlans] = useState<CramPlan[]>(() => cachedPlans ?? []);
  const [loading, setLoading] = useState(cachedPlans === null);
  const [error, setError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CramPlanStatus>("all");
  const [finishedOpen, setFinishedOpen] = useState(false);

  const loadPlans = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(cachedPlans === null);
    setError(null);
    // Read before fetching: a preview draft being deleted right now can still be
    // in this response after it has been untracked.
    const previews = new Set(trackedPreviewDrafts());
    try {
      const response = await apiFetch("/api/cram-plans", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load cram plans."));
      const next = normalizePlans(payload).filter((plan) => !previews.has(plan.id));
      cachedPlans = next;
      setPlans(next);
    } catch (caught) {
      // A failed background refresh keeps showing cached data.
      if (cachedPlans === null) {
        setError(caught instanceof Error ? caught.message : "Could not load cram plans.");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void sweepPreviewDrafts();
    void loadPlans({ background: cachedPlans !== null });
  }, [loadPlans]);

  const filtering = query.trim() !== "" || status !== "all";
  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return groupPlans(
      plans.filter((plan) => {
        if (status !== "all" && plan.status !== status) return false;
        if (!normalizedQuery) return true;
        return (
          planTitle(plan).toLowerCase().includes(normalizedQuery) ||
          plan.status.toLowerCase().includes(normalizedQuery)
        );
      }),
    );
  }, [plans, query, status]);
  const noMatches = Object.values(groups).every((group) => group.length === 0);

  function closeSearch() {
    setSearchOpen(false);
    setQuery("");
    setStatus("all");
  }

  return (
    <div className="dh-page">
      <div className="dh-page-head">
        <h1 className="dh-title">Cram</h1>
        <span className="dh-spacer" />
        {plans.length > 0 ? (
          <button
            type="button"
            className="cram-icon-btn"
            aria-label="Search plans"
            aria-expanded={searchOpen}
            title="Search plans"
            onClick={() => (searchOpen ? closeSearch() : setSearchOpen(true))}
          >
            <i className="ri-search-line" aria-hidden />
          </button>
        ) : null}
        <Link href="/cram/new" className="btn btn-primary">
          <i className="ri-add-line" aria-hidden />
          New plan
        </Link>
      </div>

      {searchOpen ? (
        <div className="dh-toolbar">
          <UntitledSearchInput
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search plans..."
            aria-label="Search cram plans"
            wrapperStyle={{ flex: 1 }}
            autoFocus
          />
          <UntitledMenuSelect
            icon="ri-filter-3-line"
            value={status}
            options={STATUS_OPTIONS}
            onChange={(value) => setStatus(value as "all" | CramPlanStatus)}
            aria-label="Filter by status"
            menuWidth={200}
          />
        </div>
      ) : null}

      {loading ? (
        <CramListSkeleton />
      ) : error ? (
        <div className="dh-empty">
          <h2>Couldn&apos;t load cram plans</h2>
          <p>{error}</p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void loadPlans()}>
            Try again
          </button>
        </div>
      ) : plans.length === 0 ? (
        <div className="dh-empty">
          <h2>No cram plans yet</h2>
          <p>Build a focused, deadline-aware plan without changing your normal study schedule.</p>
          <Link href="/cram/new" className="btn btn-primary btn-sm">
            New plan
          </Link>
        </div>
      ) : (
        <div className="cram-layout">
          <div className="cram-main">
            <CramTodayStrip plans={plans} />
            {filtering && noMatches ? (
              <div className="dh-empty">
                <h2>No plans match those filters</h2>
                <p>Try a different search or status.</p>
              </div>
            ) : (
              <>
                {!filtering || groups.active.length > 0 ? (
                  <PlanSection label="Active" plans={groups.active} empty="No active plans right now." />
                ) : null}
                <PlanSection label="Paused" plans={groups.paused} />
                <PlanSection label="Drafts" plans={groups.drafts} />
                {groups.finished.length > 0 ? (
                  <>
                    <div className="dh-section-label">
                      Finished
                      <span className="dh-spacer" />
                      {filtering ? null : (
                        <button
                          type="button"
                          className="cram-disclosure"
                          aria-expanded={finishedOpen}
                          onClick={() => setFinishedOpen((open) => !open)}
                        >
                          {finishedOpen ? "Hide" : `Show ${groups.finished.length}`}
                          <i
                            className={finishedOpen ? "ri-arrow-up-s-line" : "ri-arrow-down-s-line"}
                            aria-hidden
                          />
                        </button>
                      )}
                    </div>
                    {filtering || finishedOpen ? <PlanRows plans={groups.finished} /> : null}
                  </>
                ) : null}
              </>
            )}
          </div>
          <aside>
            <CramCalendar plans={plans} />
          </aside>
        </div>
      )}
    </div>
  );
}

function PlanSection({ label, plans, empty }: { label: string; plans: CramPlan[]; empty?: string }) {
  if (plans.length === 0 && !empty) return null;
  return (
    <>
      <div className="dh-section-label">{label}</div>
      {plans.length > 0 ? <PlanRows plans={plans} /> : <p className="cram-none">{empty}</p>}
    </>
  );
}

function PlanRows({ plans }: { plans: CramPlan[] }) {
  return (
    <section className="dh-surface">
      {plans.map((plan) => (
        <PlanRow key={plan.id} plan={plan} />
      ))}
    </section>
  );
}

function planSubline(plan: CramPlan): string {
  const cards = planCardCount(plan);
  return [
    cards === null ? null : `${cards.toLocaleString()} ${cards === 1 ? "card" : "cards"}`,
    plan.daily_minutes ? `${plan.daily_minutes} min a day` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function todayLabel(plan: CramPlan): string | null {
  if (plan.status !== "active") return null;
  const today = normalizeToday(plan.today);
  if (today?.reviewsRemaining == null) return null;
  if (today.reviewsRemaining > 0) return `${today.reviewsRemaining.toLocaleString()} left today`;
  return today.reviewsCompleted > 0 ? "Done for today" : "Nothing due";
}

function PlanRow({ plan }: { plan: CramPlan }) {
  const deadline = planDeadline(plan);
  const timezone = planTimezone(plan);
  const readiness = readinessPercent(planReadiness(plan));
  const today = todayLabel(plan);
  const finished = plan.status === "completed" || plan.status === "archived";
  const when = !deadline
    ? "No deadline"
    : finished
      ? formatDeadlineShort(deadline, { timezone, hasTime: plan.deadline_has_time })
      : daysLeftLabel(deadline, timezone);

  return (
    <div className="cram-plan">
      <div className="cram-plan__main">
        <Link href={`/cram/${plan.id}`} className="cram-plan__name">
          {planTitle(plan)}
        </Link>
        <div className="cram-plan__sub">{planSubline(plan)}</div>
      </div>
      <div title={finished ? undefined : "Where you'll be at your deadline if you keep to the plan"}>
        <div className="cram-plan__readiness">
          <span>{finished ? "Readiness" : "Projected"}</span>
          <b>{readiness === null ? "—" : `${readiness}%`}</b>
        </div>
        <div className="dh-meter">
          <span style={{ width: `${Math.min(100, Math.max(0, readiness ?? 0))}%` }} />
        </div>
      </div>
      <span className="cram-plan__when">
        {when}
        {today ? <span>{today}</span> : null}
      </span>
      <span className="cram-plan__action">
        {plan.status === "active" ? (
          <Link href={`/cram/${plan.id}/study`} className="btn btn-secondary btn-sm">
            Study
          </Link>
        ) : (
          <span className={planStatusPillClass(plan.status)}>{planStatusLabel(plan.status)}</span>
        )}
      </span>
    </div>
  );
}
