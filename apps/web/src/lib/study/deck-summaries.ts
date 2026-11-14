import type { SupabaseClient } from "@supabase/supabase-js";
import { deckDayCounts } from "@deephaus/scheduling";
import { settingsFromRecord, resolveEffectiveDeckSettings } from "@/lib/fsrs/settings";
import type { GlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import type { StudyDeckOption } from "@/lib/study/decks";

export type StudyDeckSummaryRow = {
  project_id: string;
  card_count: number;
  due_count: number;
  new_card_count: number;
  new_studied_today: number;
  last_review: string | null;
  /** The split below is missing until the review-order migration runs. */
  learning_due_count?: number;
  review_due_count?: number;
  review_due_cards_spaced?: number;
  new_cards_spaced?: number;
  reviews_today?: number;
};

export type DeckWaitingMap = Record<string, number>;

function fallbackStartOfDayIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** One SQL round-trip for all deck queue counts (study hub + sidebar badges). */
export async function fetchStudyDeckSummaries(
  supabase: SupabaseClient,
  userId: string,
  startOfDayIso?: string,
  projectIds?: string[],
): Promise<StudyDeckSummaryRow[] | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.rpc("get_study_deck_summaries", {
    p_user_id: userId,
    p_now: nowIso,
    p_start_of_day: startOfDayIso ?? fallbackStartOfDayIso(),
    ...(projectIds ? { p_project_ids: projectIds } : {}),
  });

  if (error) {
    if (error.code === "PGRST202" || /get_study_deck_summaries/i.test(error.message ?? "")) {
      return null;
    }
    throw new Error(error.message);
  }

  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    project_id: String(row.project_id),
    card_count: Number(row.card_count ?? 0),
    due_count: Number(row.due_count ?? 0),
    new_card_count: Number(row.new_card_count ?? 0),
    new_studied_today: Number(row.new_studied_today ?? 0),
    last_review: row.last_review != null ? String(row.last_review) : null,
    ...optionalCount(row, "learning_due_count"),
    ...optionalCount(row, "review_due_count"),
    ...optionalCount(row, "review_due_cards_spaced"),
    ...optionalCount(row, "new_cards_spaced"),
    ...optionalCount(row, "reviews_today"),
  }));
}

function optionalCount<K extends string>(row: Record<string, unknown>, key: K) {
  return row[key] == null ? {} : ({ [key]: Number(row[key]) } as Record<K, number>);
}

export function waitingByDeckFromSummaries(
  summaries: StudyDeckSummaryRow[],
  settingsByDeck: Map<string, ReturnType<typeof settingsFromRecord>>,
  global?: GlobalStudySettings,
): DeckWaitingMap {
  const out: DeckWaitingMap = {};
  for (const row of summaries) {
    const settings = resolveEffectiveDeckSettings(
      settingsByDeck.get(row.project_id) ?? settingsFromRecord({}),
      global,
    );
    const counts = deckDayCounts(row, settings);
    out[row.project_id] = counts.due + counts.new;
  }
  return out;
}

export function studyOptionsFromSummaries(
  summaries: StudyDeckSummaryRow[],
  projects: Array<{ id: string; name: string; deck_name: string | null; settings: unknown }>,
  global?: GlobalStudySettings,
): StudyDeckOption[] {
  const settingsById = new Map(projects.map((p) => [p.id, settingsFromRecord(p.settings)]));
  const titleById = new Map(projects.map((p) => [p.id, p.deck_name || p.name]));

  return summaries.map((row) => {
    const settings = resolveEffectiveDeckSettings(
      settingsById.get(row.project_id) ?? settingsFromRecord({}),
      global,
    );
    const counts = deckDayCounts(row, settings);
    return {
      id: row.project_id,
      title: titleById.get(row.project_id) ?? "Deck",
      due: counts.due,
      new: counts.new,
      waiting: counts.due + counts.new,
      paused: settings.paused === true,
    };
  });
}
