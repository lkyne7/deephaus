import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  generationSettingsPartialSchema,
  parseGenerationSettings,
  type GenerationSettings,
} from "@deephaus/shared";
import type { z } from "zod";

/**
 * Project-level study settings (a strict, fully-defaulted slice of the wider
 * `project.settings` JSONB blob).
 */
export interface DeckStudySettings {
  desiredRetention: number;
  newCardsPerDay: number;
  /** Deck-level FSRS weights (e.g. imported from an Anki preset). */
  fsrsParams?: number[];
}

export type GenerationSettingsPatch =
  | Partial<GenerationSettings>
  | z.infer<typeof generationSettingsPartialSchema>;

const DEFAULTS: DeckStudySettings = {
  desiredRetention: DEFAULT_DESIRED_RETENTION,
  newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
};

export function settingsFromRecord(raw: unknown): DeckStudySettings {
  try {
    const parsed = parseGenerationSettings(raw ?? {});
    return {
      desiredRetention: parsed.desiredRetention,
      newCardsPerDay: parsed.newCardsPerDay,
      fsrsParams: parsed.fsrsParams,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function loadDeckSettings(
  supabase: SupabaseClient,
  projectId: string,
): Promise<DeckStudySettings> {
  const { data } = await supabase
    .from("projects")
    .select("settings")
    .eq("id", projectId)
    .maybeSingle();
  return settingsFromRecord(data?.settings);
}

/** Apply a partial settings update onto the existing project.settings blob. */
export function mergeSettings(
  existing: unknown,
  patch: GenerationSettingsPatch,
): GenerationSettings {
  const parsedExisting = parseGenerationSettings(existing ?? {});
  const patchRecord = patch as Record<string, unknown>;
  const base: Record<string, unknown> = { ...parsedExisting };
  if ("cardMix" in patchRecord && !("cardTypes" in patchRecord)) {
    delete base.cardTypes;
  }
  return parseGenerationSettings({ ...base, ...patchRecord });
}
