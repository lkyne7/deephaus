import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_DESIRED_RETENTION,
  DEFAULT_NEW_CARDS_PER_DAY,
} from "@deephaus/shared";

export interface GlobalStudySettings {
  desiredRetention: number;
  newCardsPerDay: number;
}

export const DEFAULT_GLOBAL_STUDY_SETTINGS: GlobalStudySettings = {
  desiredRetention: DEFAULT_DESIRED_RETENTION,
  newCardsPerDay: DEFAULT_NEW_CARDS_PER_DAY,
};

export async function loadGlobalStudySettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<GlobalStudySettings> {
  const { data } = await supabase
    .from("user_study_settings")
    .select("desired_retention, new_cards_per_day")
    .eq("user_id", userId)
    .maybeSingle();

  if (!data) return { ...DEFAULT_GLOBAL_STUDY_SETTINGS };

  return {
    desiredRetention: Number(data.desired_retention) || DEFAULT_DESIRED_RETENTION,
    newCardsPerDay: Number(data.new_cards_per_day) ?? DEFAULT_NEW_CARDS_PER_DAY,
  };
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
    },
    { onConflict: "user_id" },
  );
  if (error) throw new Error(error.message);
}
