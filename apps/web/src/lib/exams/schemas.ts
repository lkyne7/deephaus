import { z } from "zod";
import {
  EXAM_DAILY_MINUTES_MAX,
  EXAM_DEFAULT_TARGET,
  EXAM_TARGET_MAX,
  EXAM_TARGET_MIN,
  normalizeExamSelection,
  normalizeStudyWindows,
} from "@deephaus/shared";
import { isValidTimeZone } from "@/lib/exams/time";

const idArray = z.array(z.string().uuid()).max(500);
const tagArray = z.array(z.string().trim().min(1).max(100)).max(100);

// What a student can choose: decks, sources and tags. Chunk and card lists
// stay in the stored shape for callers that build selections another way.
const selectionFields = {
  deck_ids: idArray.optional(),
  source_ids: idArray.optional(),
  tags: tagArray.optional(),
};

const timeZoneSchema = z.string().min(1).max(100).refine(isValidTimeZone, "Invalid IANA timezone");
const targetSchema = z.number().min(EXAM_TARGET_MIN).max(EXAM_TARGET_MAX);
const capSchema = z.number().int().min(1).max(EXAM_DAILY_MINUTES_MAX).nullable();
const windowsSchema = z.array(z.number().int().min(0).max(1439)).max(6);

function selectionOf(body: { deck_ids?: string[]; source_ids?: string[]; tags?: string[] }) {
  return normalizeExamSelection({
    deck_ids: body.deck_ids,
    source_ids: body.source_ids,
    tags: body.tags,
  });
}

function hasSelection(body: { deck_ids?: string[]; source_ids?: string[]; tags?: string[] }) {
  return body.deck_ids !== undefined || body.source_ids !== undefined || body.tags !== undefined;
}

export const createExamSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    exam_at: z.string().datetime({ offset: true }),
    timezone: timeZoneSchema.optional(),
    has_time: z.boolean().optional(),
    target_recall: targetSchema.optional(),
    daily_minutes_cap: capSchema.optional(),
    study_windows: windowsSchema.optional(),
    ...selectionFields,
  })
  .transform((body) => ({
    name: body.name,
    exam_at: body.exam_at,
    timezone: body.timezone ?? "UTC",
    has_time: body.has_time ?? false,
    target_recall: body.target_recall ?? EXAM_DEFAULT_TARGET,
    daily_minutes_cap: body.daily_minutes_cap ?? null,
    study_windows: normalizeStudyWindows(body.study_windows ?? []),
    selection_spec: selectionOf(body),
  }));

export type CreateExamInput = z.infer<typeof createExamSchema>;

export const examActionSchema = z.object({
  action: z.enum(["archive", "unarchive", "suspend_cards"]),
});

export const updateExamSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    exam_at: z.string().datetime({ offset: true }).optional(),
    timezone: timeZoneSchema.optional(),
    has_time: z.boolean().optional(),
    target_recall: targetSchema.optional(),
    daily_minutes_cap: capSchema.optional(),
    study_windows: windowsSchema.optional(),
    result_score: z.number().min(0).max(100).nullable().optional(),
    ...selectionFields,
  })
  .transform((body) => ({
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.exam_at !== undefined ? { exam_at: body.exam_at } : {}),
    ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
    ...(body.has_time !== undefined ? { has_time: body.has_time } : {}),
    ...(body.target_recall !== undefined ? { target_recall: body.target_recall } : {}),
    ...(body.daily_minutes_cap !== undefined ? { daily_minutes_cap: body.daily_minutes_cap } : {}),
    ...(body.study_windows !== undefined
      ? { study_windows: normalizeStudyWindows(body.study_windows) }
      : {}),
    ...(body.result_score !== undefined ? { result_score: body.result_score } : {}),
    ...(hasSelection(body) ? { selection_spec: selectionOf(body) } : {}),
  }))
  .refine((patch) => Object.keys(patch).length > 0, "At least one setting is required");

export type UpdateExamInput = z.infer<typeof updateExamSchema>;

export const previewExamSchema = z
  .object({
    exam_at: z.string().datetime({ offset: true }),
    timezone: timeZoneSchema.optional(),
    target_recall: targetSchema.optional(),
    daily_minutes_cap: capSchema.optional(),
    ...selectionFields,
  })
  .transform((body) => ({
    exam_at: body.exam_at,
    timezone: body.timezone ?? "UTC",
    target_recall: body.target_recall ?? EXAM_DEFAULT_TARGET,
    daily_minutes_cap: body.daily_minutes_cap ?? null,
    selection_spec: selectionOf(body),
  }));

export type PreviewExamInput = z.infer<typeof previewExamSchema>;
