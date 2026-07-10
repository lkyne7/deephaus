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
  readiness_score?: number | null;
  completion_probability?: number | null;
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
  created_at?: string;
  updated_at?: string;
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

export type CramCard = {
  id: string;
  item_id: string;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  cloze_ord: number | null;
  tags: string[];
};

export type CramQueueResponse = {
  plan?: CramPlan;
  queue?: unknown[];
  items?: unknown[];
  cards?: unknown[];
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

export type PlanAction = "start" | "pause" | "resume" | "complete" | "archive";

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
  return {
    id,
    item_id: itemId,
    type,
    front: nullableString(nested.front),
    back: nullableString(nested.back),
    cloze_text: nullableString(nested.cloze_text),
    extra: nullableString(nested.extra),
    occlusion_data: nested.occlusion_data,
    cloze_ord:
      typeof value.cloze_ord === "number"
        ? value.cloze_ord
        : typeof nested.cloze_ord === "number"
          ? nested.cloze_ord
          : null,
    tags: Array.isArray(nested.tags)
      ? nested.tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
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
