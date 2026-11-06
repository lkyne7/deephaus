import { stripCardMedia } from "@deephaus/shared";

export type CramPlanStatus = "draft" | "active" | "paused" | "completed" | "archived";

export type CramForecast = {
  readiness?:
    | number
    | {
        mean_retrievability?: number;
        target_coverage?: number;
        target_retention?: number;
        ready_items?: number;
        total_items?: number;
        unseen_items?: number;
      }
    | null;
  readiness_detail?: {
    target_coverage?: number;
    ready_items?: number;
    total_items?: number;
  } | null;
  readiness_score?: number | null;
  target_coverage?: number;
  completion_probability?: number | null;
  estimated_reviews?: number;
  total_cards?: number;
  item_count?: number;
  cards_selected?: number;
  cards_due_today?: number;
  reviews_per_day?: number;
  daily_review_capacity?: number;
  estimated_daily_minutes?: number;
  estimated_minutes?: number;
  days_remaining?: number;
  daily_budget?: number;
  feasible?: boolean;
  [key: string]: unknown;
};

export type CramToday = {
  reviewCapacity: number | null;
  reviewsCompleted: number;
  reviewsRemaining: number | null;
  estimatedSecondsPerReview: number | null;
  budgetReached: boolean;
};

export type CramPlan = {
  id: string;
  name?: string | null;
  title?: string | null;
  status: CramPlanStatus;
  deadline_at?: string | null;
  deadline?: string | null;
  deadline_timezone?: string | null;
  deadline_has_time?: boolean;
  timezone?: string | null;
  target_retention?: number | null;
  desired_retention?: number | null;
  retention?: number | null;
  daily_minutes?: number | null;
  card_count?: number | null;
  item_count?: number | null;
  readiness?: number | null;
  readiness_score?: number | null;
  forecast?: CramForecast | null;
  today?: unknown;
  created_at?: string;
  updated_at?: string;
};

export type CramForecastDay = {
  date: string;
  totalReviews: number;
};

export type CramItemPreview = {
  id?: string;
  item_id?: string;
  card_id?: string;
  front?: string | null;
  deck_name?: string | null;
  tags?: string[];
};

export type SelectionOption = {
  id: string;
  name?: string | null;
  title?: string | null;
  label?: string | null;
  count?: number | null;
  card_count?: number | null;
  deck_id?: string | null;
  deck_name?: string | null;
  source_id?: string | null;
  source_name?: string | null;
  front?: string | null;
  type?: string | null;
  tags?: string[];
};

export type TagOption = {
  tag: string;
  count?: number | null;
};

export type CramOptions = {
  decks: SelectionOption[];
  sources: SelectionOption[];
  tags: TagOption[];
  /** @deprecated Kept empty for older clients; sections are no longer selectable. */
  chunks?: SelectionOption[];
  /** @deprecated Kept empty for older clients; individual cards are no longer selectable. */
  cards?: SelectionOption[];
};

export type CramGradeIntervals = {
  again: string;
  hard: string;
  good: string;
  easy: string;
};

export type CramCard = {
  id: string;
  item_id: string;
  queue_key: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  cloze_ord: number | null;
  tags: string[];
  state: number;
  is_new: boolean;
  intervals: CramGradeIntervals | null;
};

export type CramQueueResponse = {
  plan?: CramPlan;
  queue?: unknown[];
  items?: unknown[];
  cards?: unknown[];
  counts?: unknown;
  today?: {
    daily_minutes?: number;
    review_capacity?: number;
    reviews_completed?: number;
    reviews_remaining?: number;
    minutes_spent?: number;
    budget_reached?: boolean;
  };
  daily_budget?: number;
  reviewed_today?: number;
  remaining_today?: number;
  budget_reached?: boolean;
  readiness?:
    | number
    | {
        mean_retrievability?: number;
        target_coverage?: number;
        target_retention?: number;
      }
    | null;
  readiness_score?: number | null;
};

export type PlanAction = "start" | "pause" | "resume" | "complete" | "archive" | "unarchive";

export function planTitle(plan: CramPlan): string {
  return plan.name?.trim() || plan.title?.trim() || "Untitled cram plan";
}

export function planDeadline(plan: CramPlan): string | null {
  return plan.deadline_at ?? plan.deadline ?? null;
}

export function planReadiness(
  plan: CramPlan,
  forecast: CramForecast | null | undefined = plan.forecast,
): number | null {
  const forecastReadiness = forecast?.readiness;
  const nestedReadiness =
    typeof forecastReadiness === "object" && forecastReadiness !== null
      ? forecastReadiness.target_coverage ?? forecastReadiness.mean_retrievability
      : forecastReadiness;
  const value =
    nestedReadiness ??
    forecast?.readiness_score ??
    forecast?.completion_probability ??
    plan.readiness ??
    plan.readiness_score;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function readinessPercent(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round((value <= 1 ? value * 100 : value));
}

export function planCardCount(plan: CramPlan): number | null {
  return (
    plan.card_count ??
    plan.item_count ??
    plan.forecast?.item_count ??
    plan.forecast?.total_cards ??
    null
  );
}

export function planTimezone(plan: CramPlan): string | null {
  return plan.deadline_timezone ?? plan.timezone ?? null;
}

export function planStatusLabel(status: CramPlanStatus): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function planStatusPillClass(status: CramPlanStatus): string {
  if (status === "active") return "dh-pill dh-pill--accent";
  if (status === "paused") return "dh-pill cram-pill--paused";
  if (status === "archived") return "dh-pill dh-pill--outline";
  return "dh-pill";
}

function deadlineTime(plan: CramPlan): number {
  const deadline = planDeadline(plan);
  const time = deadline ? new Date(deadline).getTime() : Number.NaN;
  return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
}

/** "12 of 36", counting what's done against what's planned for today. */
export function todayProgress(today: CramToday | null): string {
  if (!today) return "—";
  const planned = today.reviewsCompleted + (today.reviewsRemaining ?? 0);
  if (planned === 0) return "Nothing due";
  return `${today.reviewsCompleted.toLocaleString()} of ${planned.toLocaleString()}`;
}

export type PlanGroups = Record<"active" | "paused" | "drafts" | "finished", CramPlan[]>;

/** Soonest deadline first, except finished plans, which show the latest first. */
export function groupPlans(plans: CramPlan[]): PlanGroups {
  const soonest = (a: CramPlan, b: CramPlan) => deadlineTime(a) - deadlineTime(b);
  const withStatus = (...statuses: CramPlanStatus[]) =>
    plans.filter((plan) => statuses.includes(plan.status));
  return {
    active: withStatus("active").sort(soonest),
    paused: withStatus("paused").sort(soonest),
    drafts: withStatus("draft").sort(soonest),
    finished: withStatus("completed", "archived").sort((a, b) => soonest(b, a)),
  };
}

export type TodaySummary = {
  sessions: number;
  pendingPlans: number;
  remaining: number;
  minutes: number;
  next: CramPlan | null;
};

/** Today's remaining work across active plans; `next` is the soonest deadline with cards left. */
export function summarizeToday(plans: CramPlan[]): TodaySummary {
  const sessions = groupPlans(plans).active.flatMap((plan) => {
    const today = normalizeToday(plan.today);
    return today ? [{ plan, today }] : [];
  });
  const pending = sessions.filter(({ today }) => (today.reviewsRemaining ?? 0) > 0);
  const seconds = pending.reduce(
    (sum, { today }) =>
      sum + (today.reviewsRemaining ?? 0) * (today.estimatedSecondsPerReview ?? 0),
    0,
  );
  return {
    sessions: sessions.length,
    pendingPlans: pending.length,
    remaining: pending.reduce((sum, { today }) => sum + (today.reviewsRemaining ?? 0), 0),
    minutes: seconds > 0 ? Math.max(1, Math.round(seconds / 60)) : 0,
    next: pending[0]?.plan ?? null,
  };
}

/** Reviews the forecast actually plans per day, not the budget's upper limit. */
export function averageDailyReviews(forecast: CramForecast | null | undefined): number | null {
  const reviews = forecast?.estimated_reviews;
  const days = forecast?.days_remaining;
  if (typeof reviews !== "number" || typeof days !== "number" || days <= 0) return null;
  return Math.round(reviews / days);
}

export const DAILY_BUDGET_STOPS = [
  5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 75, 90, 105, 120, 150, 180, 210, 240, 300, 360, 420, 480,
] as const;

export function nearestBudgetStop(minutes: number): number {
  let best = 0;
  DAILY_BUDGET_STOPS.forEach((stop, index) => {
    if (Math.abs(stop - minutes) < Math.abs(DAILY_BUDGET_STOPS[best] - minutes)) best = index;
  });
  return best;
}

type DeadlineFormat = {
  timezone?: string | null;
  hasTime?: boolean;
  now?: Date;
  viewerTimeZone?: string;
  locale?: string;
};

function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function safeFormat(date: Date, options: Intl.DateTimeFormatOptions, zone: string, locale?: string): string {
  const format = (timeZone?: string) =>
    new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(date).replace(/\u202f/g, " ");
  try {
    return format(zone);
  } catch {
    return format();
  }
}

/**
 * A date-only deadline is the calendar day the user picked, so it stays in the
 * plan's zone. An exact time stays there too unless that zone is UTC, which
 * nobody lives in: those read in the viewer's own time.
 */
function deadlineZone(timezone: string | null | undefined, hasTime: boolean, viewer: string): string {
  if (!timezone) return viewer;
  return hasTime && timezone === "UTC" ? viewer : timezone;
}

/** "Friday, Nov 13", or "Friday, Nov 13 at 9:00 AM" when the plan has an exact time. */
export function formatDeadlineLong(iso: string, format: DeadlineFormat = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid deadline";
  const viewer = format.viewerTimeZone ?? browserTimeZone();
  const hasTime = format.hasTime === true;
  const zone = deadlineZone(format.timezone, hasTime, viewer);
  const now = format.now ?? new Date();
  const day = safeFormat(
    date,
    {
      weekday: "long",
      month: "short",
      day: "numeric",
      year: date.getUTCFullYear() === now.getUTCFullYear() ? undefined : "numeric",
    },
    zone,
    format.locale,
  );
  if (!hasTime) return day;
  const time = safeFormat(date, { hour: "numeric", minute: "2-digit" }, zone, format.locale);
  const place = zone === viewer ? "" : ` ${(zone.split("/").pop() ?? zone).replaceAll("_", " ")} time`;
  return `${day} at ${time}${place}`;
}

/** "Nov 13", with the year when it isn't this year. */
export function formatDeadlineShort(iso: string, format: DeadlineFormat = {}): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid deadline";
  const viewer = format.viewerTimeZone ?? browserTimeZone();
  const now = format.now ?? new Date();
  return safeFormat(
    date,
    {
      month: "short",
      day: "numeric",
      year: date.getUTCFullYear() === now.getUTCFullYear() ? undefined : "numeric",
    },
    deadlineZone(format.timezone, format.hasTime === true, viewer),
    format.locale,
  );
}

function zonedDayNumber(date: Date, zone: string): number {
  const key = safeFormat(date, { year: "numeric", month: "2-digit", day: "2-digit" }, zone, "en-CA");
  return Date.parse(`${key}T00:00:00Z`) / 86_400_000;
}

/** Calendar days to the deadline in the plan's own zone. */
export function daysLeftLabel(iso: string, timezone?: string | null, now = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  if (date.getTime() <= now.getTime()) return "Deadline passed";
  const zone = timezone || browserTimeZone();
  const days = zonedDayNumber(date, zone) - zonedDayNumber(now, zone);
  if (days <= 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `${days} days left`;
}

export type ReadinessHero = {
  value: number | null;
  label: string;
  headline: string;
  detail: string | null;
  showChart: boolean;
};

/**
 * `current` is what the plan's cards would recall at the deadline with no more
 * study; `projected` assumes the forecast's reviews happen.
 */
export function readinessHero(input: {
  status: CramPlanStatus;
  current: number | null;
  projected: number | null;
  target: number | null;
  dailyMinutes: number | null;
  readyItems: number | null;
  totalItems: number | null;
  deadlinePassed: boolean;
}): ReadinessHero {
  const { status, current, projected, target } = input;
  const targetText = target === null ? "your target" : `your ${target}% target`;
  const budget = input.dailyMinutes ? `${input.dailyMinutes} minutes a day` : "your daily budget";

  if (status === "completed" || status === "archived" || input.deadlinePassed) {
    return {
      value: current ?? projected,
      label: status === "completed" ? "Final readiness" : "Readiness",
      headline: status === "archived" ? "This plan is archived" : "This plan is finished",
      detail:
        input.readyItems !== null && input.totalItems
          ? `${input.readyItems.toLocaleString()} of ${input.totalItems.toLocaleString()} cards reached ${targetText}.`
          : null,
      showChart: false,
    };
  }
  if (projected === null) {
    return { value: current, label: "Ready now", headline: "No forecast yet", detail: null, showChart: false };
  }
  if (status === "draft") {
    return {
      value: projected,
      label: "Predicted readiness",
      headline: `Predicted ${projected}% by your deadline`,
      detail: `Start the plan and keep to ${budget} to get there.`,
      showChart: current !== null,
    };
  }
  if (status === "paused") {
    return {
      value: current,
      label: "Ready now",
      headline: "This plan is paused",
      detail: `Resume and keep to ${budget} to reach about ${projected}%.`,
      showChart: current !== null,
    };
  }
  const onTrack = target !== null && projected >= target;
  return {
    value: current,
    label: "Ready now",
    headline: onTrack
      ? `On track for ${projected}% by your deadline`
      : `Heading for ${projected}% by your deadline`,
    detail: onTrack
      ? `Keep to ${budget} to clear ${targetText}.`
      : `That's short of ${targetText} at ${budget}.`,
    showChart: current !== null,
  };
}

export type PreviewRun = { text: string; strong: boolean };

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

/** Card text for one-line lists: markup removed, bold kept as runs. */
export function previewRuns(value: string | null | undefined): PreviewRun[] {
  if (!value) return [];
  const text = stripCardMedia(value)
    .replace(/<\s*\/?\s*(?:strong|b)\b[^>]*>/gi, "**")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/\{\{c\d+::(.*?)(?:::[^}]*)?\}\}/g, "$1")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^(?:#{1,6}\s+|[-+*]\s+|>\s+|\d+\.\s+)/, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\$(?=\S)([^$]*?\S)\$(?!\d)/g, "$1")
    .replace(/~~(.+?)~~/g, "$1")
    .replace(/__(.+?)__/g, "**$1**")
    .replace(/(?<![*\w\\])\*(?=[^\s*])([^*]*?[^\s*])\*(?![*\w])/g, "$1")
    .replace(/(?<![_\w\\])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text
    .split(/\*\*(.+?)\*\*/g)
    .map((part, index) => ({
      text: part.replaceAll("**", "").replace(/\\([*_`$[\]])/g, "$1"),
      strong: index % 2 === 1,
    }))
    .filter((run) => run.text.length > 0);
}

export function plainPreview(value: string | null | undefined): string {
  return previewRuns(value)
    .map((run) => run.text)
    .join("");
}

export function normalizeOptions(value: unknown): CramOptions {
  const root = isRecord(value) ? value : {};
  const options = isRecord(root.options) ? root.options : root;
  return {
    decks: optionArray(options.decks),
    sources: optionArray(options.sources),
    tags: tagArray(options.tags),
  };
}

export function normalizePlans(value: unknown): CramPlan[] {
  if (Array.isArray(value)) return value.filter(isPlan);
  if (!isRecord(value)) return [];
  const plans = value.plans ?? value.data;
  return Array.isArray(plans) ? plans.filter(isPlan) : [];
}

export function normalizeQueueItem(value: unknown): CramCard | null {
  if (!isRecord(value)) return null;
  const nested = isRecord(value.card) ? value.card : value;
  const id = stringValue(nested.id) ?? stringValue(nested.card_id) ?? stringValue(value.card_id);
  const itemId =
    stringValue(value.item_id) ??
    stringValue(value.id) ??
    stringValue(nested.item_id) ??
    id;
  if (!id || !itemId) return null;
  const rawType = stringValue(nested.type) ?? stringValue(nested.card_type);
  const type =
    rawType === "cloze" || rawType === "image-occlusion" ? rawType : "basic";
  const clozeOrd =
    typeof value.cloze_ord === "number"
      ? value.cloze_ord
      : typeof nested.cloze_ord === "number"
        ? nested.cloze_ord
        : null;
  const state = typeof nested.state === "number" ? nested.state : 0;
  return {
    id,
    item_id: itemId,
    queue_key: stringValue(nested.queue_key) ?? `${itemId}:${clozeOrd ?? 0}`,
    type,
    front: nullableString(nested.front),
    back: nullableString(nested.back),
    cloze_text: nullableString(nested.cloze_text),
    extra: nullableString(nested.extra),
    occlusion_data: nested.occlusion_data,
    cloze_ord: clozeOrd,
    tags: Array.isArray(nested.tags)
      ? nested.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    state,
    is_new: nested.is_new === true || state === 0,
    intervals: normalizeIntervals(nested.intervals),
  };
}

function normalizeIntervals(value: unknown): CramGradeIntervals | null {
  if (!isRecord(value)) return null;
  const again = stringValue(value.again);
  const hard = stringValue(value.hard);
  const good = stringValue(value.good);
  const easy = stringValue(value.easy);
  if (!again || !hard || !good || !easy) return null;
  return { again, hard, good, easy };
}

export function normalizeToday(value: unknown): CramToday | null {
  if (!isRecord(value)) return null;
  const capacity = finiteNumber(value.review_capacity);
  const completed = finiteNumber(value.reviews_completed) ?? 0;
  const remaining = finiteNumber(value.reviews_remaining);
  return {
    reviewCapacity: capacity,
    reviewsCompleted: completed,
    reviewsRemaining: remaining,
    estimatedSecondsPerReview: finiteNumber(value.estimated_seconds_per_review),
    budgetReached:
      value.budget_reached === true ||
      (capacity !== null && completed >= capacity),
  };
}

/** Extract the projected per-day review schedule from a plan forecast. */
export function forecastDaily(forecast: CramForecast | null | undefined): CramForecastDay[] {
  if (!forecast || !Array.isArray(forecast.daily)) return [];
  return forecast.daily.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const date = stringValue(entry.date);
    const total = finiteNumber(entry.total_reviews);
    if (!date || total === null) return [];
    return [{ date, totalReviews: total }];
  });
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getErrorMessage(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  const message = value.error ?? value.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPlan(value: unknown): value is CramPlan {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.status === "string"
  );
}

function optionArray(value: unknown): SelectionOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.id !== "string") return [];
    return [item as SelectionOption];
  });
}

function tagArray(value: unknown): TagOption[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string") return [{ tag: item }];
    if (!isRecord(item)) return [];
    const tag = stringValue(item.tag) ?? stringValue(item.name) ?? stringValue(item.label);
    return tag ? [{ tag, count: typeof item.count === "number" ? item.count : null }] : [];
  });
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
