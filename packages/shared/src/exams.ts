/**
 * Exams: the wire types shared by the web API, the offline replica and the
 * phone. An exam is a date, a target and a selection of cards; everything
 * else here is derived from the cards' real memory by @deephaus/scheduling.
 */

export const EXAM_STATUSES = ["active", "completed", "archived"] as const;
export type ExamStatus = (typeof EXAM_STATUSES)[number];

export const EXAM_TARGET_MIN = 0.7;
export const EXAM_TARGET_MAX = 0.97;
export const EXAM_DEFAULT_TARGET = 0.9;
export const EXAM_DAILY_MINUTES_MAX = 720;
/**
 * An exam saved with a date but no time is planned for this local hour, so
 * study finishes before a morning sitting instead of running through the day.
 * Every client must use it, or the same exam would plan differently by device.
 */
export const EXAM_DATE_ONLY_HOUR = 9;

export type ExamSelectionSpec = {
  deck_ids: string[];
  source_ids: string[];
  chunk_ids: string[];
  tags: string[];
  card_ids: string[];
};

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ];
}

/** A stored or submitted selection, tolerant of JSON text and missing keys. */
export function normalizeExamSelection(raw: unknown): ExamSelectionSpec {
  let spec = raw;
  if (typeof spec === "string") {
    try {
      spec = JSON.parse(spec);
    } catch {
      spec = null;
    }
  }
  const record = spec && typeof spec === "object" ? (spec as Record<string, unknown>) : {};
  return {
    deck_ids: uniqueStrings(record.deck_ids),
    source_ids: uniqueStrings(record.source_ids),
    chunk_ids: uniqueStrings(record.chunk_ids),
    tags: uniqueStrings(record.tags),
    card_ids: uniqueStrings(record.card_ids),
  };
}

export function isEmptyExamSelection(spec: ExamSelectionSpec): boolean {
  return (
    spec.deck_ids.length === 0 &&
    spec.source_ids.length === 0 &&
    spec.chunk_ids.length === 0 &&
    spec.tags.length === 0 &&
    spec.card_ids.length === 0
  );
}

/** Preferred study times as minutes after local midnight, sorted and unique. */
export function normalizeStudyWindows(raw: unknown): number[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      value = null;
    }
  }
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is number => typeof entry === "number" && Number.isFinite(entry))
        .map((entry) => Math.round(entry))
        .filter((entry) => entry >= 0 && entry < 1440),
    ),
  ].sort((a, b) => a - b);
}

/** public.exams, as stored. */
export type ExamRow = {
  id: string;
  user_id: string;
  name: string;
  exam_at: string;
  timezone: string;
  has_time: boolean;
  target_recall: number;
  daily_minutes_cap: number | null;
  selection_spec: ExamSelectionSpec;
  study_windows: number[];
  result_score: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Archived wins; otherwise an exam is over once its time has passed. */
export function examStatus(
  exam: Pick<ExamRow, "exam_at" | "archived_at">,
  now: Date = new Date(),
): ExamStatus {
  if (exam.archived_at) return "archived";
  const examAt = Date.parse(exam.exam_at);
  return Number.isFinite(examAt) && examAt <= now.getTime() ? "completed" : "active";
}

export type ExamStageName = "learn" | "strengthen" | "lock-in" | "exam-day" | "done";

export type ExamSnapshotDto = {
  stage: ExamStageName;
  total: number;
  unseen: number;
  /** Seen, but predicted below target at exam time. */
  at_risk: number;
  /** Predicted at or above target at exam time. */
  locked_in: number;
  /** Mean predicted recall if the exam were now. */
  recall_now: number;
  /** Mean predicted recall at exam time with no further study. */
  recall_at_exam: number;
  share_at_target: number;
};

export type ExamPlanDayDto = {
  /** Local date the study day starts on, YYYY-MM-DD. */
  date: string;
  reviews: number;
  new_cards: number;
  minutes: number;
  /** Mean predicted exam-time recall once this day's work is done. */
  recall_at_exam: number;
};

export type ExamScorePointDto = {
  /** Null is "as long as the plan asks for". */
  minutes_per_day: number | null;
  recall_at_exam: number;
};

export type ExamPlanDto = {
  days: ExamPlanDayDto[];
  projected: { recall_at_exam: number; share_at_target: number; unseen: number };
  on_track: boolean;
  /** Without a time cap: a typical day, the heaviest day, and the total. */
  needed: { typical_minutes: number; peak_minutes: number; total_minutes: number };
  curve: ExamScorePointDto[];
};

export type ExamDeckBreakdownDto = {
  project_id: string;
  name: string | null;
  total: number;
  unseen: number;
  at_risk: number;
  locked_in: number;
  recall_at_exam: number;
};

export type ExamSummaryDto = {
  id: string;
  name: string;
  exam_at: string;
  timezone: string;
  has_time: boolean;
  target_recall: number;
  daily_minutes_cap: number | null;
  selection_spec: ExamSelectionSpec;
  study_windows: number[];
  result_score: number | null;
  status: ExamStatus;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  snapshot: ExamSnapshotDto;
  /** Cards worth studying right now, and how long they take. */
  ready_now: number;
  minutes_now: number;
  /** When the next session is worth doing; null when nothing more is needed. */
  next_session_at: string | null;
};

export type ExamInsightDto = {
  snapshot: ExamSnapshotDto;
  plan: ExamPlanDto;
  decks: ExamDeckBreakdownDto[];
};

export type ExamDetailDto = ExamInsightDto & { exam: ExamSummaryDto };

export type ExamListResponse = { exams: ExamSummaryDto[] };

export type ExamSelectionBody = {
  deck_ids?: string[];
  source_ids?: string[];
  tags?: string[];
};

export type CreateExamBody = ExamSelectionBody & {
  name: string;
  exam_at: string;
  timezone?: string;
  has_time?: boolean;
  target_recall?: number;
  daily_minutes_cap?: number | null;
  study_windows?: number[];
};

export type UpdateExamBody = Partial<CreateExamBody> & {
  result_score?: number | null;
};

export type PreviewExamBody = ExamSelectionBody & {
  exam_at: string;
  timezone?: string;
  target_recall?: number;
  daily_minutes_cap?: number | null;
};

/**
 * `suspend_cards` takes the exam's cards out of all future study: the "let
 * them go" choice once an exam is over.
 */
export type ExamAction = "archive" | "unarchive" | "suspend_cards";

/** Why a card is in an exam session. */
export type ExamCardReason = "learning" | "first-learning" | "strengthen" | "lock-in" | "new";

type ExamGradeLabel = "again" | "hard" | "good" | "easy";

/** One card of an exam session. The shape Study Mode already reads, plus why. */
export type ExamQueueCard = {
  id: string;
  queue_key: string;
  cloze_ord: number | null;
  type: "basic" | "cloze" | "image-occlusion";
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  occlusion_data?: unknown;
  tags: string[];
  state: number;
  due: string;
  reps: number;
  lapses: number;
  is_new: boolean;
  intervals: Record<ExamGradeLabel, string>;
  deck_id: string;
  deck_name: string;
  reason: ExamCardReason;
};

export type ExamQueueResponse = {
  /** The session's title for Study Mode: the exam, standing in for a deck. */
  deck: { id: string; name: string };
  cards: ExamQueueCard[];
  counts: { due: number; new: number; learning: number; total: number };
  day_start_hour: number;
  learn_ahead: boolean;
  exam: ExamSummaryDto;
  /** Ready cards left out because today's time cap is spent. */
  skipped: number;
  /** When the next card not yet ready becomes ready, if that is today. */
  next_ready_at: string | null;
};

export type ExamSelectorDeck = { id: string; name: string; card_count: number };
export type ExamSelectorSource = {
  id: string;
  name: string;
  deck_id: string;
  deck_name: string | null;
  type: string;
  card_count: number;
};
export type ExamSelectorTag = { tag: string; count: number };

export type ExamSelectorOptions = {
  options: {
    decks: ExamSelectorDeck[];
    sources: ExamSelectorSource[];
    tags: ExamSelectorTag[];
  };
};
