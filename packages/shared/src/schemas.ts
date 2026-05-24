import { z } from "zod";

export const cardTypeSchema = z.enum(["basic", "cloze"]);
export type CardType = z.infer<typeof cardTypeSchema>;

export const generatedCardSchema = z.object({
  type: cardTypeSchema,
  front: z.string().optional(),
  back: z.string().optional(),
  clozeText: z.string().optional(),
  extra: z.string().optional(),
  tags: z.array(z.string()).default([]),
});

export type GeneratedCard = z.infer<typeof generatedCardSchema>;

export const generatedCardsResponseSchema = z.object({
  cards: z.array(generatedCardSchema),
});

export type GeneratedCardsResponse = z.infer<typeof generatedCardsResponseSchema>;

export const cardMixSchema = z.enum(["basic", "cloze", "both"]);
export type CardMix = z.infer<typeof cardMixSchema>;

export const generationSettingsSchema = z.object({
  cardMix: cardMixSchema.default("both"),
  density: z.number().min(1).max(20).default(5),
  focusPrompt: z.string().optional(),
});

export type GenerationSettings = z.infer<typeof generationSettingsSchema>;

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

export const sourceTypeSchema = z.enum(["text", "pdf"]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

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

export const MAX_CLOZE_DELETIONS = 3;
export const MAX_PDF_BYTES = 25 * 1024 * 1024;
export const MAX_CARDS_PER_JOB = 200;
export const CHUNK_TARGET_CHARS = 6000;
export const CHUNK_OVERLAP_CHARS = 400;
