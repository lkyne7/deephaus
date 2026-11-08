import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_FOCUS_PRESET,
  FOCUS_PRESET_OPTIONS,
  qualityLevelSchema,
  type CardMix,
  type DetailLevel,
  type FocusPreset,
  type GenerationSettings,
  type QualityLevel,
} from "@deephaus/shared";

const STORAGE_KEY = "@deephaus/create-options";

export type CardTypeChoice = CardMix | "both";

/** The card options the Create composer remembers between sources. */
export type CreateOptions = {
  detailLevel: DetailLevel;
  /** Model strength; each level costs a different number of credits per card. */
  qualityLevel: QualityLevel;
  cardType: CardTypeChoice;
  focusPreset: FocusPreset;
  autoTags: boolean;
};

export const DEFAULT_CREATE_OPTIONS: CreateOptions = {
  detailLevel: "medium",
  qualityLevel: "medium",
  cardType: "basic",
  focusPreset: DEFAULT_FOCUS_PRESET,
  autoTags: true,
};

/** Fall back field by field, so a stale or partial value can't break Create. */
export function parseCreateOptions(raw: string | null): CreateOptions {
  try {
    const value = JSON.parse(raw ?? "{}") as Partial<CreateOptions>;
    const fallback = DEFAULT_CREATE_OPTIONS;
    return {
      detailLevel: ["low", "medium", "high"].includes(value.detailLevel ?? "")
        ? (value.detailLevel as DetailLevel)
        : fallback.detailLevel,
      qualityLevel: qualityLevelSchema.safeParse(value.qualityLevel).data ?? fallback.qualityLevel,
      cardType: ["basic", "cloze", "both"].includes(value.cardType ?? "")
        ? (value.cardType as CardTypeChoice)
        : fallback.cardType,
      focusPreset: FOCUS_PRESET_OPTIONS.some((option) => option.value === value.focusPreset)
        ? (value.focusPreset as FocusPreset)
        : fallback.focusPreset,
      autoTags: typeof value.autoTags === "boolean" ? value.autoTags : fallback.autoTags,
    };
  } catch {
    return DEFAULT_CREATE_OPTIONS;
  }
}

export async function loadCreateOptions(): Promise<CreateOptions> {
  return parseCreateOptions(await AsyncStorage.getItem(STORAGE_KEY).catch(() => null));
}

export function saveCreateOptions(options: CreateOptions) {
  void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(options)).catch(() => undefined);
}

/** The settings for one run. Instructions apply to that run only. */
export function generationSettings(
  options: CreateOptions,
  customInstructions?: string,
): Partial<GenerationSettings> {
  const both = options.cardType === "both";
  const instructions = customInstructions?.trim();
  return {
    detailLevel: options.detailLevel,
    qualityLevel: options.qualityLevel,
    cardMix: both ? "basic" : (options.cardType as CardMix),
    cardTypes: both ? ["basic", "cloze"] : [options.cardType as CardMix],
    focusPreset: options.focusPreset,
    autoTags: options.autoTags,
    ...(instructions ? { customInstructions: instructions } : {}),
  };
}
