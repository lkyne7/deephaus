import { z } from "zod";

export const cardTypeSchema = z.enum(["basic", "cloze", "image-occlusion"]);
export type CardType = z.infer<typeof cardTypeSchema>;

// OpenAI's strict json_schema returns `null` for fields the model doesn't fill
// (e.g. `clozeText: null` on a basic card), so accept nullable strings here.
export const generatedCardSchema = z.object({
  type: cardTypeSchema,
  front: z.string().nullish(),
  back: z.string().nullish(),
  clozeText: z.string().nullish(),
  extra: z.string().nullish(),
  /**
   * Short verbatim excerpt of the source text this card tests. Used to
   * highlight the exact passage in the source document ("evidence span").
   */
  sourceQuote: z.string().nullish(),
  tags: z.array(z.string()).default([]),
});

export type GeneratedCard = z.infer<typeof generatedCardSchema> & {
  /**
   * Source provenance attached programmatically after generation (never produced
   * by the model). Lets the processor link each card to the chunk it came from.
   */
  sourceRef?: string;
  chunkIndex?: number;
};

export const generatedCardsResponseSchema = z.object({
  cards: z.array(generatedCardSchema),
});

export type GeneratedCardsResponse = z.infer<typeof generatedCardsResponseSchema>;

export const cardMixSchema = z.enum(["basic", "cloze"]);
export type CardMix = z.infer<typeof cardMixSchema>;

export const detailLevelSchema = z.enum(["low", "medium", "high"]);
export type DetailLevel = z.infer<typeof detailLevelSchema>;

/**
 * Preset that steers what the generator emphasizes. Replaces the older
 * free-text focus prompt with a fixed set of high-signal options.
 */
export const focusPresetSchema = z.enum([
  "balanced",
  "exam",
  "concepts",
  "definitions",
  "application",
]);
export type FocusPreset = z.infer<typeof focusPresetSchema>;

export const DEFAULT_FOCUS_PRESET: FocusPreset = "balanced";

export interface FocusPresetOption {
  value: FocusPreset;
  label: string;
  description: string;
  /**
   * Instruction injected into the generation prompt. Empty for "balanced",
   * which uses the model's default high-yield behavior.
   */
  prompt: string;
}

export const FOCUS_PRESET_OPTIONS: FocusPresetOption[] = [
  {
    value: "balanced",
    label: "Balanced",
    description: "Balanced cards from the most useful content",
    prompt: "",
  },
  {
    value: "exam",
    label: "Exam",
    description: "High-yield cards for tests and assessments",
    prompt:
      "Prioritize high-yield, testable material most likely to appear on exams and assessments: facts, distinctions, and commonly tested details. Skip trivia unlikely to be assessed.",
  },
  {
    value: "concepts",
    label: "Concepts",
    description: "Main ideas, frameworks, and principles",
    prompt:
      "Prioritize the main ideas, frameworks, models, and underlying principles. Emphasize conceptual understanding and how ideas relate over isolated facts or vocabulary.",
  },
  {
    value: "definitions",
    label: "Definitions",
    description: "Key vocabulary, terminology, and meanings",
    prompt:
      "Prioritize key vocabulary, terminology, and precise definitions. Each card should test the meaning of an important term or the term for a given definition.",
  },
  {
    value: "application",
    label: "Application",
    description: "Case-based or problem-solving cards",
    prompt:
      "Prioritize application over recall: write case-based, scenario, and problem-solving cards that require applying concepts to new situations, working through examples, or reasoning to an answer.",
  },
];

/** Resolve a focus preset value to its full option (falls back to the default). */
export function focusPresetOption(preset?: FocusPreset | null): FocusPresetOption {
  return (
    FOCUS_PRESET_OPTIONS.find((option) => option.value === preset) ??
    FOCUS_PRESET_OPTIONS[0]!
  );
}

/**
 * The focus instruction to inject into a generation prompt, resolved from the
 * new preset first and falling back to any legacy free-text focus prompt.
 * Returns `undefined` when no specific steering applies (default behavior).
 */
export function resolveFocusInstruction(settings: {
  focusPreset?: FocusPreset | null;
  focusPrompt?: string | null;
}): string | undefined {
  if (settings.focusPreset) {
    const prompt = focusPresetOption(settings.focusPreset).prompt.trim();
    return prompt || undefined;
  }
  const legacy = settings.focusPrompt?.trim();
  return legacy || undefined;
}

const generationSettingsBaseSchema = z.object({
  cardMix: z.union([cardMixSchema, z.literal("both")]).default("basic"),
  /**
   * Text card types to generate (front/back and/or fill-in-the-blank). When
   * present this supersedes cardMix; cardMix is kept as the primary type for
   * backward compatibility with older clients and stored project settings.
   */
  cardTypes: z.array(cardMixSchema).optional(),
  /**
   * Auto-detect diagrams/images in document sources (PDF, PowerPoint) and turn
   * them into image-occlusion cards alongside the text cards.
   */
  autoImageOcclusion: z.boolean().optional(),
  /**
   * Let the model add short hints to cloze deletions when helpful
   * (Anki `{{c1::answer::hint}}` syntax). Ignored for non-cloze cards.
   */
  clozeHints: z.boolean().optional(),
  /** Auto-generate flat topic/source tags on new cards. Defaults to true. */
  autoTags: z.boolean().optional(),
  detailLevel: detailLevelSchema.default("medium"),
  /** @deprecated Use detailLevel. Kept for legacy project settings. */
  density: z.number().min(1).max(20).optional(),
  /** Preset that steers what the generator emphasizes. */
  focusPreset: focusPresetSchema.optional(),
  /** @deprecated Use focusPreset. Legacy free-text focus steering. */
  focusPrompt: z.string().optional(),
  desiredRetention: z.number().min(0.7).max(0.97).default(0.9),
  newCardsPerDay: z.number().int().min(0).max(200).default(10),
  /** Deck-level FSRS weights (e.g. imported from an Anki preset). */
  fsrsParams: z.array(z.number()).optional(),
  /** When true, desiredRetention and newCardsPerDay follow the user's global profile settings. */
  useGlobalFsrsSettings: z.boolean().optional(),
});

export type GenerationSettings = {
  cardMix: CardMix;
  /** Resolved set of text card types to generate (always at least one entry). */
  cardTypes: CardMix[];
  autoImageOcclusion: boolean;
  clozeHints: boolean;
  autoTags: boolean;
  detailLevel: DetailLevel;
  density?: number;
  focusPreset?: FocusPreset;
  focusPrompt?: string;
  desiredRetention: number;
  newCardsPerDay: number;
  fsrsParams?: number[];
  useGlobalFsrsSettings?: boolean;
};

/** Stored/raw project settings (may include legacy cardMix "both"). */
export const generationSettingsSchema = generationSettingsBaseSchema;

export const generationSettingsPartialSchema = generationSettingsBaseSchema.partial();

/** Dedupe + preserve order, keeping only valid text card types. */
function dedupeCardTypes(types: CardMix[]): CardMix[] {
  const seen = new Set<CardMix>();
  const out: CardMix[] = [];
  for (const t of types) {
    if (t !== "basic" && t !== "cloze") continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/**
 * Resolve which text card types should be generated, reconciling the new
 * `cardTypes` array with the legacy `cardMix` ("both" → basic + cloze).
 */
export function resolveTextCardTypes(raw: {
  cardTypes?: CardMix[] | null;
  cardMix?: CardMix | "both" | null;
}): CardMix[] {
  // An explicit array — even an empty one — is an intentional choice. An empty
  // array means "no text cards" (e.g. image-occlusion only).
  if (Array.isArray(raw.cardTypes)) {
    return dedupeCardTypes(raw.cardTypes);
  }
  // Legacy settings without cardTypes: derive from the older cardMix field.
  if (raw.cardMix === "both") return ["basic", "cloze"];
  if (raw.cardMix === "cloze") return ["cloze"];
  return ["basic"];
}

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
  const cardTypes = resolveTextCardTypes(data);
  return {
    ...data,
    cardMix: cardTypes[0] ?? "basic",
    cardTypes,
    autoImageOcclusion: data.autoImageOcclusion ?? false,
    clozeHints: data.clozeHints ?? false,
    autoTags: data.autoTags ?? true,
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

export const sourceTypeSchema = z.enum([
  "text",
  "pdf",
  "docx",
  "pptx",
  "video",
  "youtube",
  "topic",
  "notion",
]);
export type SourceType = z.infer<typeof sourceTypeSchema>;

export const MAX_SOURCE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const MAX_PDF_BYTES = MAX_SOURCE_FILE_BYTES;
/** Anki .apkg packages are media-heavy and can be far larger than other sources. */
export const MAX_APKG_BYTES = 10 * 1024 * 1024 * 1024;

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
  occlusion_data?: unknown;
  tags: string[];
  sort_order: number;
  user_edited: boolean;
  /** Structured link to the source segment this card was generated from. */
  source_chunk_id?: string | null;
  /** Denormalized human label of the source segment (e.g. "PDF::Page3"). */
  source_ref?: string | null;
  /** Verbatim excerpt of the source passage this card was generated from. */
  source_quote?: string | null;
  created_at: string;
  updated_at: string;
}

export interface TextChunk {
  text: string;
  sourceRef: string;
  index: number;
}

/** A persisted source segment (mirrors the `source_chunks` table). */
export interface SourceChunkRecord {
  id: string;
  source_id: string;
  chunk_index: number;
  source_ref: string;
  label: string | null;
  content: string;
  page_start: number | null;
  page_end: number | null;
  char_count: number | null;
  token_count: number | null;
  created_at: string;
}

/** Resolved "View source" payload for a single card. */
export interface CardSourceLocation {
  sourceId: string;
  sourceType: SourceType;
  sourceRef: string | null;
  label: string | null;
  content: string | null;
  pageStart: number | null;
  pageEnd: number | null;
  /** Rendered page/slide image (data URL) for PDF/PPTX sources, when available. */
  pageImageUrl: string | null;
  /** Deep link to the original (e.g. a timestamped YouTube URL), when available. */
  externalUrl: string | null;
}

export const MAX_CLOZE_DELETIONS = 9;
export const MAX_CARD_IMAGE_BYTES = 5 * 1024 * 1024;
export const CARD_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;
export const MAX_CARDS_PER_JOB = 1000;
/** Max PDF pages or PPTX slides processed for notes, image extraction, and occlusion. */
export const MAX_SOURCE_DOCUMENT_PAGES = 2000;
export const CHUNK_TARGET_CHARS = 6000;
export const CHUNK_OVERLAP_CHARS = 400;
