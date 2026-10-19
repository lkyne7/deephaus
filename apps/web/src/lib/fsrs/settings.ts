import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
  parseGenerationSettings,
  type GenerationSettings,
  type EasyDays,
} from "@deephaus/shared";
import {
  DEFAULT_GLOBAL_STUDY_SETTINGS,
  loadGlobalStudySettings,
  type GlobalStudySettings,
} from "@/lib/fsrs/user-study-settings";

/**
 * Project-level study settings (a strict, fully-defaulted slice of the wider
 * `project.settings` JSONB blob).
 */
export interface DeckStudySettings {
  easyDays?: EasyDays;
  dayStartHour?: number;
  timezone?: string | null;
  desiredRetention: number;
  newCardsPerDay: number;
  /** Deck-level FSRS weights (e.g. imported from an Anki preset). */
  fsrsParams?: number[];
  /** When true, retention and new-card limits follow the user's global profile settings. */
  useGlobalFsrsSettings?: boolean;
}

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
      useGlobalFsrsSettings: parsed.useGlobalFsrsSettings,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

/** Weekly preferences apply to every deck; retention and limits follow the deck’s opt-in. */
export function resolveEffectiveDeckSettings(
  deck: DeckStudySettings,
  global: GlobalStudySettings = DEFAULT_GLOBAL_STUDY_SETTINGS,
): DeckStudySettings {
  const weekly = { easyDays: global.easyDays, dayStartHour: global.dayStartHour, timezone: global.timezone };
  if (!deck.useGlobalFsrsSettings) return { ...deck, ...weekly };
  return {
    ...deck,
    ...weekly,
    desiredRetention: global.desiredRetention,
    newCardsPerDay: global.newCardsPerDay,
  };
}

export async function loadDeckSettings(
  supabase: SupabaseClient,
  projectId: string,
  userId?: string,
): Promise<DeckStudySettings> {
  const { data } = await supabase
    .from("projects")
    .select("settings")
    .eq("id", projectId)
    .maybeSingle();
  const deck = settingsFromRecord(data?.settings);
  if (!userId) return deck;
  const global = await loadGlobalStudySettings(supabase, userId);
  return resolveEffectiveDeckSettings(deck, global);
}

/** Apply a partial settings update onto the existing project.settings blob. */
export function mergeSettings(
  existing: unknown,
  patch: Partial<GenerationSettings> & { clearFsrsParams?: boolean },
): GenerationSettings {
  const parsedExisting = parseGenerationSettings(existing ?? {});
  const { clearFsrsParams, ...rest } = patch;
  const merged = parseGenerationSettings({ ...parsedExisting, ...rest });
  if (clearFsrsParams) {
    delete merged.fsrsParams;
  }
  return merged;
}

export async function resolveDeckSettingsForProjects(
  supabase: SupabaseClient,
  userId: string,
  projects: Array<{ id: string; settings: unknown }>,
): Promise<Map<string, DeckStudySettings>> {
  const global = await loadGlobalStudySettings(supabase, userId);
  return new Map(
    projects.map((project) => [
      project.id,
      resolveEffectiveDeckSettings(settingsFromRecord(project.settings), global),
    ]),
  );
}
