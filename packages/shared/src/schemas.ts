import { z } from "zod";

export const cardTypeSchema = z.enum(["basic", "cloze"]);
export type CardType = z.infer<typeof cardTypeSchema>;

// OpenAI's strict json_schema returns `null` for fields the model doesn't fill
// (e.g. `clozeText: null` on a basic card), so accept nullable strings here.
export const generatedCardSchema = z.object({
  type: cardTypeSchema,
  front: z.string().nullish(),
  back: z.string().nullish(),
  clozeText: z.string().nullish(),
  extra: z.string().nullish(),
  tags: z.array(z.string()).default([]),
});

export type GeneratedCard = z.infer<typeof generatedCardSchema>;

export const generatedCardsResponseSchema = z.object({
  cards: z.array(generatedCardSchema),
});

export type GeneratedCardsResponse = z.infer<typeof generatedCardsResponseSchema>;

export const cardMixSchema = z.enum(["basic", "cloze"]);
export type CardMix = z.infer<typeof cardMixSchema>;

export const detailLevelSchema = z.enum(["low", "medium", "high"]);
export type DetailLevel = z.infer<typeof detailLevelSchema>;

const generationSettingsBaseSchema = z.object({
  cardMix: z.union([cardMixSchema, z.literal("both")]).default("basic"),
  detailLevel: detailLevelSchema.default("medium"),
  /** @deprecated Use detailLevel. Kept for legacy project settings. */
  density: z.number().min(1).max(20).optional(),
  focusPrompt: z.string().optional(),
  desiredRetention: z.number().min(0.7).max(0.97).default(0.9),
  newCardsPerDay: z.number().int().min(0).max(200).default(10),
});

export type GenerationSettings = {
  cardMix: CardMix;
  detailLevel: DetailLevel;
  density?: number;
  focusPrompt?: string;
  desiredRetention: number;
  newCardsPerDay: number;
};

/** Stored/raw project settings (may include legacy cardMix "both"). */
export const generationSettingsSchema = generationSettingsBaseSchema;

export const generationSettingsPartialSchema = generationSettingsBaseSchema.partial();

export function parseGenerationSettings(raw: unknown): GenerationSettings {
  const data = generationSettingsBaseSchema.parse(raw ?? {});
  const detailLevel =
    data.detailLevel ??
    (data.density != null
      ? data.density <= 3
        ? "low"
        : data.density <= 7
          ? "medium"
          : "high"
      : "medium");
  return {
    ...data,
    cardMix: data.cardMix === "both" ? "basic" : data.cardMix,
    detailLevel,
  };
}

export function mergeGenerationSettingsPatch(
  patch?: z.infer<typeof generationSettingsPartialSchema>,
): GenerationSettings | undefined {
  if (!patch) return undefined;
  return parseGenerationSettings({
    cardMix: "basic",
    detailLevel: "medium",
    desiredRetention: DEFAULT_DESIRED_RETENTION,
    newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
    ...patch,
  });
}

export const DEFAULT_DESIRED_RETENTION = 0.9;
export const DEFAULT_NEW_CARDS_PER_DAY = 10;

export const jobStatusSchema = z.enum([
  "pending",
  "uploaded",
  "extracting",
  "chunking",
  "generating",
  "ready",
  "failed",
]);

export type JobStatus = z.infer<typeof jobStatusSchema>;

export const sourceTypeSchema = z.enum(["text", "pdf", "docx", "pptx", "video", "youtube"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_BYTES = MAX_SOURCE_FILE_BYTES;

export interface Project {
  id: string;
  user_id: string;
  name: string;
  deck_name: string;
  settings: GenerationSettings;
  created_at: string;
  updated_at: string;
}

export interface Source {
  id: string;
  project_id: string;
  type: SourceType;
  raw_text: string | null;
  storage_path: string | null;
  page_count: number | null;
  created_at: string;
}

export interface GenerationJob {
  id: string;
  source_id: string;
  status: JobStatus;
  error: string | null;
  token_usage: number | null;
  progress: number;
  created_at: string;
  updated_at: string;
}

export interface DraftCard {
  id: string;
  job_id: string;
  type: CardType;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  sort_order: number;
  user_edited: boolean;
  created_at: string;
  updated_at: string;
}

export interface TextChunk {
  text: string;
  sourceRef: string;
  index: number;
}

export const MAX_CLOZE_DELETIONS = 9;
export const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;
export const CARD_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const MAX_CARDS_PER_JOB = 200;
export const CHUNK_TARGET_CHARS = 6000;
export const CHUNK_OVERLAP_CHARS = 400;
