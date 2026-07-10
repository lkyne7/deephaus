import { z } from "zod";
import { isValidTimeZone } from "@/lib/cram/time";
import { normalizeSelectionSpec } from "@/lib/cram/selection";

const idArray = z.array(z.string().uuid()).max(500).default([]);
const tagArray = z.array(z.string().trim().min(1).max(100)).max(100).default([]);

export const selectionSpecSchema = z.object({
  deck_ids: idArray,
  source_ids: idArray,
  chunk_ids: idArray,
  tags: tagArray,
  card_ids: idArray,
});

const rawSelectionFields = {
  deck_ids: idArray.optional(),
  source_ids: idArray.optional(),
  chunk_ids: idArray.optional(),
  tags: tagArray.optional(),
  card_ids: idArray.optional(),
  selection_spec: selectionSpecSchema.partial().optional(),
};

const timeZoneSchema = z
  .string()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, "Invalid IANA timezone");

export const createCramPlanSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    deadline_at: z.string().datetime({ offset: true }),
    deadline_timezone: timeZoneSchema.optional(),
    timezone: timeZoneSchema.optional(),
    deadline_has_time: z.boolean().optional(),
    target_retention: z.number().min(0.7).max(0.97).optional(),
    desired_retention: z.number().min(0.7).max(0.97).optional(),
    daily_minutes: z.number().int().min(1).max(720),
    ...rawSelectionFields,
  })
  .transform((body) => ({
    name: body.name,
    deadline_at: body.deadline_at,
    deadline_timezone: body.deadline_timezone ?? body.timezone ?? "UTC",
    deadline_has_time: body.deadline_has_time ?? false,
    target_retention: body.target_retention ?? body.desired_retention ?? 0.9,
    daily_minutes: body.daily_minutes,
    selection_spec: normalizeSelectionSpec({
      ...(body.selection_spec ?? {}),
      deck_ids: body.deck_ids ?? body.selection_spec?.deck_ids,
      source_ids: body.source_ids ?? body.selection_spec?.source_ids,
      tags: body.tags ?? body.selection_spec?.tags,
      // Cram selection is limited to decks, sources, and tags.
      chunk_ids: [],
      card_ids: [],
    }),
  }));

export const cramPlanActionSchema = z.object({
  action: z.enum(["start", "pause", "resume", "complete", "archive"]),
});

export const updateCramPlanSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    deadline_at: z.string().datetime({ offset: true }).optional(),
    deadline_timezone: timeZoneSchema.optional(),
    timezone: timeZoneSchema.optional(),
    deadline_has_time: z.boolean().optional(),
    target_retention: z.number().min(0.7).max(0.97).optional(),
    desired_retention: z.number().min(0.7).max(0.97).optional(),
    daily_minutes: z.number().int().min(1).max(720).optional(),
    ...rawSelectionFields,
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.deadline_at !== undefined ||
      body.deadline_timezone !== undefined ||
      body.timezone !== undefined ||
      body.deadline_has_time !== undefined ||
      body.target_retention !== undefined ||
      body.desired_retention !== undefined ||
      body.daily_minutes !== undefined ||
      body.selection_spec !== undefined ||
      body.deck_ids !== undefined ||
      body.source_ids !== undefined ||
      body.chunk_ids !== undefined ||
      body.tags !== undefined ||
      body.card_ids !== undefined,
    "At least one setting is required",
  )
  .transform((body) => {
    const hasSelection =
      body.selection_spec !== undefined ||
      body.deck_ids !== undefined ||
      body.source_ids !== undefined ||
      body.chunk_ids !== undefined ||
      body.tags !== undefined ||
      body.card_ids !== undefined;
    return {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.deadline_at !== undefined ? { deadline_at: body.deadline_at } : {}),
      ...(body.deadline_timezone !== undefined || body.timezone !== undefined
        ? { deadline_timezone: body.deadline_timezone ?? body.timezone }
        : {}),
      ...(body.deadline_has_time !== undefined
        ? { deadline_has_time: body.deadline_has_time }
        : {}),
      ...(body.target_retention !== undefined || body.desired_retention !== undefined
        ? { target_retention: body.target_retention ?? body.desired_retention }
        : {}),
      ...(body.daily_minutes !== undefined ? { daily_minutes: body.daily_minutes } : {}),
      ...(hasSelection
        ? {
            selection_spec: normalizeSelectionSpec({
              ...(body.selection_spec ?? {}),
              deck_ids: body.deck_ids ?? body.selection_spec?.deck_ids,
              source_ids: body.source_ids ?? body.selection_spec?.source_ids,
              tags: body.tags ?? body.selection_spec?.tags,
              // Cram selection is limited to decks, sources, and tags.
              chunk_ids: [],
              card_ids: [],
            }),
          }
        : {}),
    };
  });

export const previewCramPlanSchema = z.object({
  deadline_at: z.string().datetime({ offset: true }).optional(),
  deadline_timezone: timeZoneSchema.optional(),
  timezone: timeZoneSchema.optional(),
  target_retention: z.number().min(0.7).max(0.97).optional(),
  desired_retention: z.number().min(0.7).max(0.97).optional(),
  daily_minutes: z.number().int().min(1).max(720).optional(),
});

export const reviewCramItemSchema = z.object({
  item_id: z.string().uuid(),
  rating: z.number().int().min(1).max(4),
  response_ms: z.number().int().min(0).max(3_600_000),
});
