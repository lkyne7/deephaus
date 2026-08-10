"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { DashboardSectionHeader } from "@/components/dashboard/dashboard-section-header";
import { PageHeaderSlot } from "@/components/page-header-context";
import { UntitledMenuSelect, UntitledSearchInput } from "@/components/ui/untitled-controls";
import { apiFetch } from "@/lib/api/fetch";
import { CramCalendar, CramTodayStrip } from "./cram-upcoming";
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
const CRAM_BREADCRUMBS = [{ label: "Cram" }];

type ViewMode = "table" | "grid";
const VIEW_MODE_STORAGE_KEY = "deephaus.cramViewMode";

/** Session cache so returning to the page renders instantly while refreshing. */
let cachedPlans: CramPlan[] | null = null;

type SortKey = "name" | "status" | "deadline" | "readiness" | "cards";
type SortDir = "asc" | "desc";

const COLUMNS: Array<{ key: SortKey; label: string; width?: number }> = [
  { key: "name", label: "Plan name" },
  { key: "status", label: "Status", width: 110 },
  { key: "deadline", label: "Deadline", width: 130 },
  { key: "readiness", label: "Projected readiness", width: 200 },
  { key: "cards", label: "Cards", width: 88 },
];

const DEFAULT_DIR: Record<SortKey, SortDir> = {
  name: "asc",
  status: "asc",
  deadline: "asc",
  readiness: "desc",
  cards: "desc",
};

/** Ordering used when sorting by status: most actionable first. */
const STATUS_RANK: Record<string, number> = {
  active: 0,
  draft: 1,
  paused: 2,
  completed: 3,
  archived: 4,
};

function planCardCount(plan: CramPlan): number | null {
  return (
    plan.card_count ??
    plan.item_count ??
    plan.forecast?.item_count ??
    plan.forecast?.total_cards ??
    null
  );
}

function comparePlans(a: CramPlan, b: CramPlan, key: SortKey): number {
  switch (key) {
    case "name":
      return planTitle(a).localeCompare(planTitle(b));
    case "status":
      return (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    case "readiness":
      return (planReadiness(a) ?? -1) - (planReadiness(b) ?? -1);
    case "cards":
      return (planCardCount(a) ?? -1) - (planCardCount(b) ?? -1);
    case "deadline":
    default: {
      const av = planDeadline(a);
      const bv = planDeadline(b);
      const at = av ? new Date(av).getTime() : Number.MAX_SAFE_INTEGER;
      const bt = bv ? new Date(bv).getTime() : Number.MAX_SAFE_INTEGER;
      return at - bt;
    }
  }
}

export function CramPlansView() {
  const router = useRouter();
  const [plans, setPlans] = useState<CramPlan[]>(() => cachedPlans ?? []);
  const [loading, setLoading] = useState(cachedPlans === null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"all" | CramPlanStatus>("all");
  const [view, setView] = useState<ViewMode>("table");
  // Default: Active → Draft → Paused → Completed → Archived (see STATUS_RANK).
  const [sortKey, setSortKey] = useState<SortKey>("status");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      if (stored === "table" || stored === "grid") setView(stored);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const setViewMode = useCallback((mode: ViewMode) => {
    setView(mode);
    try {
      window.localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const loadPlans = useCallback(async ({ background = false } = {}) => {
    if (!background) setLoading(cachedPlans === null);
    setError(null);
    try {
      const response = await apiFetch("/api/cram-plans", { cache: "no-store" });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new Error(getErrorMessage(payload, "Could not load cram plans."));
      const next = normalizePlans(payload);
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
    void loadPlans({ background: cachedPlans !== null });
  }, [loadPlans]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const base = plans.filter((plan) => {
      if (status !== "all" && plan.status !== status) return false;
      if (!normalizedQuery) return true;
      return (
        planTitle(plan).toLowerCase().includes(normalizedQuery) ||
        plan.status.toLowerCase().includes(normalizedQuery)
      );
    });
    return [...base].sort((a, b) => {
      // Grid always groups Active → Draft/Paused → Completed → Archived.
      if (view === "grid") {
        const byStatus = comparePlans(a, b, "status");
        if (byStatus !== 0) return byStatus;
        return comparePlans(a, b, "deadline");
      }
      const cmp = comparePlans(a, b, sortKey);
      if (cmp !== 0) return sortDir === "asc" ? cmp : -cmp;
      // Within the same primary value, keep Active-first groups stable by deadline.
      if (sortKey === "status") return comparePlans(a, b, "deadline");
      return comparePlans(a, b, "status");
    });
  }, [plans, query, status, sortKey, sortDir, view]);

  function activateSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(DEFAULT_DIR[key]);
    }
  }

  return (
    <div className="cram-page">
      <PageHeaderSlot title="Cram" breadcrumbs={CRAM_BREADCRUMBS} />
      <DashboardSectionHeader
        title="Cram"
        rightAction={
          <Link href="/cram/new" className="btn btn-primary btn-sm">
            <i className="ri-add-line" aria-hidden />
            New Cram Plan
          </Link>
        }
      />

      {!loading && !error ? (
        <>
          <CramTodayStrip plans={plans} />
          <CramCalendar plans={plans} />
        </>
      ) : null}

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
      ) : (
        <section>
          <DashboardSectionHeader
            title="Cram Plans"
            icon="ri-timer-flash-line"
            count={plans.length}
            rightAction={
              plans.length > 0 ? (
                <div className="cram-toolbar">
                  <UntitledSearchInput
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search plans..."
                    aria-label="Search cram plans"
                    wrapperStyle={{ width: 260, maxWidth: "100%" }}
                  />
                  <UntitledMenuSelect
                    icon="ri-filter-3-line"
                    value={status}
                    options={STATUS_OPTIONS}
                    onChange={(value) => setStatus(value as "all" | CramPlanStatus)}
                    aria-label="Filter by status"
                    menuWidth={200}
                  />
                  <div className="dh-view-toggle" role="group" aria-label="Plan view">
                    <ViewButton
                      active={view === "table"}
                      icon="ri-list-check"
                      label="Table view"
                      onClick={() => setViewMode("table")}
                    />
                    <ViewButton
                      active={view === "grid"}
                      icon="ri-layout-grid-line"
                      label="Grid view"
                      onClick={() => setViewMode("grid")}
                    />
                  </div>
                </div>
              ) : undefined
            }
          />

          {plans.length === 0 ? (
            <div className="cram-state">
              <i className="ri-timer-flash-line" aria-hidden />
              <h2>No cram plans yet</h2>
              <p>Build a focused, deadline-aware plan without changing your normal study schedule.</p>
              <Link href="/cram/new" className="btn btn-primary btn-sm">
                New Cram Plan
              </Link>
            </div>
          ) : filtered.length === 0 ? (
            <div className="cram-state">
              <i className="ri-search-line" aria-hidden />
              <h2>No plans match those filters</h2>
              <p>Try a different search or status.</p>
            </div>
          ) : view === "grid" ? (
            <div className="cram-plan-grid">
              {filtered.map((plan) => (
                <PlanCard key={plan.id} plan={plan} />
              ))}
            </div>
          ) : (
            <div style={s.tableCard}>
              <div style={s.tableScroll}>
                <table style={s.table}>
                  <thead>
                    <tr>
                      {COLUMNS.map((col) => {
                        const active = sortKey === col.key;
                        return (
                          <th key={col.key} style={{ ...s.th, width: col.width }}>
                            <button
                              type="button"
                              style={{
                                ...s.thButton,
                                color: active ? "var(--ink-700)" : "var(--fg-4)",
                              }}
                              onClick={() => activateSort(col.key)}
                            >
                              {col.label}
                              <i
                                className={
                                  active
                                    ? sortDir === "asc"
                                      ? "ri-arrow-up-s-line"
                                      : "ri-arrow-down-s-line"
                                    : "ri-arrow-up-down-line"
                                }
                                style={{ ...s.sortIcon, opacity: active ? 1 : 0.4 }}
                                aria-hidden
                              />
                            </button>
                          </th>
                        );
                      })}
                      <th style={{ ...s.th, width: 120 }} aria-hidden />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((plan) => {
                      const deadline = planDeadline(plan);
                      const readiness = readinessPercent(planReadiness(plan));
                      const cardCount = planCardCount(plan);
                      return (
                        <tr
                          key={plan.id}
                          style={s.tr}
                          className="dh-deck-table-row"
                          onClick={() => router.push(`/cram/${plan.id}`)}
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") router.push(`/cram/${plan.id}`);
                          }}
                        >
                          <td style={s.td}>
                            <div style={s.nameCell}>
                              <span style={s.planIcon}>
                                <i className="ri-timer-flash-line" aria-hidden />
                              </span>
                              <span style={{ minWidth: 0 }}>
                                <span style={s.planName}>{planTitle(plan)}</span>
                                <span style={s.planSub}>
                                  {cardCount !== null
                                    ? `${cardCount.toLocaleString()} cards`
                                    : "—"}
                                  {plan.daily_minutes
                                    ? ` · ${plan.daily_minutes} min/day`
                                    : ""}
                                </span>
                              </span>
                            </div>
                          </td>
                          <td style={s.td}>
                            <span className={`chip ${statusChipClass(plan.status)}`}>
                              <span className="chip-dot" />
                              {statusLabel(plan.status)}
                            </span>
                          </td>
                          <td style={s.td}>
                            <span style={s.deadlineLabel}>
                              {deadline
                                ? formatDeadline(deadline, plan.deadline_timezone ?? plan.timezone)
                                : "—"}
                            </span>
                          </td>
                          <td style={s.td}>
                            {readiness !== null ? (
                              <div style={s.progressCell}>
                                <span style={s.progressTrack}>
                                  <span
                                    style={{
                                      ...s.progressFill,
                                      width: `${Math.min(100, Math.max(0, readiness))}%`,
                                    }}
                                  />
                                </span>
                                <span style={s.progressPct}>{readiness}%</span>
                              </div>
                            ) : (
                              <span style={s.deadlineLabel}>—</span>
                            )}
                          </td>
                          <td style={s.td}>
                            <span style={s.deadlineLabel}>
                              {cardCount !== null ? cardCount.toLocaleString() : "—"}
                            </span>
                          </td>
                          <td style={{ ...s.td, textAlign: "right" }}>
                            {plan.status === "active" ? (
                              <Link
                                href={`/cram/${plan.id}/study`}
                                className="btn btn-secondary btn-sm"
                                onClick={(event) => event.stopPropagation()}
                              >
                                Study
                              </Link>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function ViewButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dh-view-toggle-btn"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
    >
      <i className={icon} aria-hidden />
    </button>
  );
}

function PlanCard({ plan }: { plan: CramPlan }) {
  const deadline = planDeadline(plan);
  const readiness = readinessPercent(planReadiness(plan));
  const cardCount = planCardCount(plan);

  return (
    <Link href={`/cram/${plan.id}`} className="cram-plan-card">
      <div className="cram-plan-card-top">
        <span className={`chip ${statusChipClass(plan.status)}`}>
          <span className="chip-dot" />
          {statusLabel(plan.status)}
        </span>
        <span className="cram-plan-card-date">
          {deadline ? formatDeadline(deadline, plan.deadline_timezone ?? plan.timezone) : "No deadline"}
        </span>
      </div>
      <h2 className="cram-plan-card-title">{planTitle(plan)}</h2>
      {readiness !== null ? (
        <div>
          <div className="cram-metric-head">
            <span className="cram-metric-label" title="Projected readiness at test time if you keep up with the planned reviews">Projected readiness</span>
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

function statusLabel(status: CramPlanStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
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

const s: Record<string, React.CSSProperties> = {
  tableCard: {
    background: "var(--white)",
    border: "1px solid var(--border-2)",
    borderRadius: 8,
    overflow: "hidden",
  },
  tableScroll: {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
  },
  table: {
    width: "100%",
    minWidth: 860,
    borderCollapse: "collapse",
    tableLayout: "fixed",
    font: "400 13px/18px var(--font-sans)",
  },
  th: {
    textAlign: "left",
    padding: "10px 16px",
    background: "var(--paper-soft)",
    borderBottom: "1px solid var(--border-1)",
  },
  thButton: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    border: "none",
    background: "transparent",
    padding: 0,
    cursor: "pointer",
    font: "500 12px/1 var(--font-sans)",
  },
  sortIcon: {
    fontSize: 14,
    lineHeight: 1,
  },
  tr: {
    cursor: "pointer",
    borderBottom: "1px solid var(--border-1)",
    outline: "none",
  },
  td: {
    padding: "12px 16px",
    verticalAlign: "middle",
    color: "var(--ink-700)",
  },
  nameCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
  },
  planIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: 8,
    flexShrink: 0,
    background: "color-mix(in srgb, var(--orange-500) 14%, transparent)",
    color: "var(--orange-600)",
    fontSize: 16,
  },
  planName: {
    display: "block",
    font: "500 14px/18px var(--font-sans)",
    color: "var(--ink-900)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  planSub: {
    display: "block",
    marginTop: 2,
    font: "400 12px/16px var(--font-sans)",
    color: "var(--fg-4)",
  },
  deadlineLabel: {
    font: "400 13px/18px var(--font-sans)",
    color: "var(--fg-secondary)",
  },
  progressCell: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 120,
  },
  progressTrack: {
    position: "relative",
    flex: 1,
    maxWidth: 120,
    height: 6,
    borderRadius: 999,
    background: "var(--ink-25)",
    overflow: "hidden",
  },
  progressFill: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    background: "var(--teal-500)",
  },
  progressPct: {
    font: "500 12px/16px var(--font-sans)",
    color: "var(--ink-600)",
    minWidth: 34,
    textAlign: "right",
  },
};
