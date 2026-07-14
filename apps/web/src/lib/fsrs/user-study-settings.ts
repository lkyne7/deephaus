import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
} from "@deephaus/shared";
import {
  clampDayStartHour,
  DEFAULT_DAY_START_HOUR,
  startOfStudyDayIso,
} from "@/lib/study/day-start";

export interface GlobalStudySettings {
  desiredRetention: number;
  newCardsPerDay: number;
  /** Hour (0–23) the study day rolls over, like Anki's "next day starts at". */
  dayStartHour: number;
  /** IANA timezone the rollover hour is interpreted in (captured on save). */
  timezone: string | null;
}

export const DEFAULT_GLOBAL_STUDY_SETTINGS: GlobalStudySettings = {
  desiredRetention: DEFAULT_DESIRED_RETENTION,
  newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
  dayStartHour: DEFAULT_DAY_START_HOUR,
  timezone: null,
};

export async function loadGlobalStudySettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<GlobalStudySettings> {
  // Select * so this keeps working before the day_start_hour migration runs.
  const { data } = await supabase
    .from("user_study_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { ...DEFAULT_GLOBAL_STUDY_SETTINGS };

  return {
    desiredRetention: Number(data.desired_retention) || DEFAULT_DESIRED_RETENTION,
    newCardsPerDay: Number(data.new_cards_per_day) ?? DEFAULT_NEW_CARDS_PER_DAY,
    dayStartHour: clampDayStartHour(data.day_start_hour),
    timezone: typeof data.timezone === "string" && data.timezone ? data.timezone : null,
  };
}

/** Start of the user's current study day (honors the rollover-hour setting). */
export async function loadStudyDayStartIso(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<string> {
  const settings = await loadGlobalStudySettings(supabase, userId);
  return startOfStudyDayIso(now, settings.dayStartHour, settings.timezone);
}

export async function saveGlobalStudySettings(
  supabase: SupabaseClient,
  userId: string,
  settings: GlobalStudySettings,
): Promise<void> {
  const { error } = await supabase.from("user_study_settings").upsert(
    {
      user_id: userId,
      desired_retention: settings.desiredRetention,
      new_cards_per_day: settings.newCardsPerDay,
      day_start_hour: clampDayStartHour(settings.dayStartHour),
      timezone: settings.timezone,
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}
