import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  generationSettingsSchema,
  type GenerationSettings,
} from "@deephaus/shared";

/**
 * Project-level study settings (a strict, fully-defaulted slice of the wider
 * `project.settings` JSONB blob).
 */
export interface DeckStudySettings {
  desiredRetention: number;
  newCardsPerDay: number;
}

const DEFAULTS: DeckStudySettings = {
  desiredRetention: DEFAULT_DESIRED_RETENTION,
  newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
};

export function settingsFromRecord(raw: unknown): DeckStudySettings {
  const parsed = generationSettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ...DEFAULTS };
  return {
    desiredRetention: parsed.data.desiredRetention,
    newCardsPerDay: parsed.data.newCardsPerDay,
  };
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
  patch: Partial<GenerationSettings>,
): GenerationSettings {
  const parsedExisting = generationSettingsSchema.parse(existing ?? {});
  return generationSettingsSchema.parse({ ...parsedExisting, ...patch });
}
