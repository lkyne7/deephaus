/**
 * How a deck lays out a day's study, after Anki's display-order and limit
 * options. Set once as study defaults; a deck can follow them or keep its own.
 */

/** Where new cards go relative to reviews. Cards being learned always come first. */
export type NewCardPosition = "after" | "mixed" | "before";

/** Which due reviews come first. */
export type ReviewSortOrder = "due" | "retrievability" | "random";

export interface ReviewOrderSettings {
  /**
   * Anki's "bury siblings": once one gap of a cloze or image-occlusion card is
   * studied, its other gaps wait for the next study day, so one gap never
   * gives away another. Cards being learned are never held back.
   */
  spaceOutSiblings: boolean;
  newCardPosition: NewCardPosition;
  reviewSortOrder: ReviewSortOrder;
  /**
   * Most review cards a deck shows in a study day; null for no limit. Cards
   * being learned or relearned are never capped.
   */
  maxReviewsPerDay: number | null;
}

export const NEW_CARD_POSITIONS: readonly NewCardPosition[] = ["after", "mixed", "before"];
export const REVIEW_SORT_ORDERS: readonly ReviewSortOrder[] = ["due", "retrievability", "random"];
export const MAX_REVIEWS_PER_DAY_LIMIT = 9999;

export const DEFAULT_REVIEW_ORDER: ReviewOrderSettings = {
  spaceOutSiblings: true,
  newCardPosition: "after",
  reviewSortOrder: "due",
  maxReviewsPerDay: null,
};

export const NEW_CARD_POSITION_LABELS: Record<NewCardPosition, string> = {
  after: "After reviews",
  mixed: "Mixed with reviews",
  before: "Before reviews",
};

export const REVIEW_SORT_ORDER_LABELS: Record<ReviewSortOrder, string> = {
  due: "Due date, oldest first",
  retrievability: "Most likely forgotten first",
  random: "Random",
};

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  // SQLite (the phone's replica) stores booleans as 0/1.
  if (value === 1 || value === "1" || value === "true") return true;
  if (value === 0 || value === "0" || value === "false") return false;
  return undefined;
}

function asPosition(value: unknown): NewCardPosition | undefined {
  return NEW_CARD_POSITIONS.includes(value as NewCardPosition)
    ? (value as NewCardPosition)
    : undefined;
}

function asSortOrder(value: unknown): ReviewSortOrder | undefined {
  return REVIEW_SORT_ORDERS.includes(value as ReviewSortOrder)
    ? (value as ReviewSortOrder)
    : undefined;
}

/** A review cap from storage: a whole number in range, null for none, undefined when unset. */
export function parseMaxReviewsPerDay(value: unknown): number | null | undefined {
  if (value === null) return null;
  if (value === undefined || value === "") return undefined;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.max(0, Math.min(MAX_REVIEWS_PER_DAY_LIMIT, Math.round(n)));
}

/** Whatever valid fields `raw` holds; anything missing or malformed is left out. */
export function parsePartialReviewOrder(raw: unknown): Partial<ReviewOrderSettings> {
  if (!raw || typeof raw !== "object") return {};
  const record = raw as Record<string, unknown>;
  const out: Partial<ReviewOrderSettings> = {};
  const space = asBoolean(record.spaceOutSiblings);
  if (space !== undefined) out.spaceOutSiblings = space;
  const position = asPosition(record.newCardPosition);
  if (position) out.newCardPosition = position;
  const sort = asSortOrder(record.reviewSortOrder);
  if (sort) out.reviewSortOrder = sort;
  const cap = parseMaxReviewsPerDay(record.maxReviewsPerDay);
  if (cap !== undefined) out.maxReviewsPerDay = cap;
  return out;
}

/** The study defaults' columns (user_study_settings) as settings. */
export function reviewOrderFromRow(row: {
  space_out_siblings?: unknown;
  new_card_position?: unknown;
  review_sort_order?: unknown;
  max_reviews_per_day?: unknown;
} | null | undefined): ReviewOrderSettings {
  if (!row) return { ...DEFAULT_REVIEW_ORDER };
  return {
    spaceOutSiblings: asBoolean(row.space_out_siblings) ?? DEFAULT_REVIEW_ORDER.spaceOutSiblings,
    newCardPosition: asPosition(row.new_card_position) ?? DEFAULT_REVIEW_ORDER.newCardPosition,
    reviewSortOrder: asSortOrder(row.review_sort_order) ?? DEFAULT_REVIEW_ORDER.reviewSortOrder,
    maxReviewsPerDay: parseMaxReviewsPerDay(row.max_reviews_per_day) ?? null,
  };
}

export function reviewOrderToRow(settings: ReviewOrderSettings) {
  return {
    space_out_siblings: settings.spaceOutSiblings,
    new_card_position: settings.newCardPosition,
    review_sort_order: settings.reviewSortOrder,
    max_reviews_per_day: settings.maxReviewsPerDay,
  };
}

/**
 * A deck's effective order. A deck that follows the study defaults takes them
 * whole; otherwise each option the deck has set wins, and the defaults fill
 * in the rest.
 */
export function resolveReviewOrder(
  deck: Partial<ReviewOrderSettings> | undefined,
  defaults: ReviewOrderSettings,
  followDefaults: boolean,
): ReviewOrderSettings {
  if (followDefaults || !deck) return { ...defaults };
  return { ...defaults, ...parsePartialReviewOrder(deck) };
}
