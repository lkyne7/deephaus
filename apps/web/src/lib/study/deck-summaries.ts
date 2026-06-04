import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import type { StudyDeckOption } from "@/lib/study/decks";

export type StudyDeckSummaryRow = {
  project_id: string;
  card_count: number;
  due_count: number;
  new_card_count: number;
  new_studied_today: number;
  last_review: string | null;
};

export type DeckWaitingMap = Record<string, number>;

function startOfDayIso(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return start.toISOString();
}

/** One SQL round-trip for all deck queue counts (study hub + sidebar badges). */
export async function fetchStudyDeckSummaries(
  supabase: SupabaseClient,
  userId: string,
): Promise<StudyDeckSummaryRow[] | null> {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.rpc("get_study_deck_summaries", {
    p_user_id: userId,
    p_now: nowIso,
    p_start_of_day: startOfDayIso(),
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
  }));
}

export function waitingByDeckFromSummaries(
  summaries: StudyDeckSummaryRow[],
  settingsByDeck: Map<string, ReturnType<typeof settingsFromRecord>>,
): DeckWaitingMap {
  const out: DeckWaitingMap = {};
  for (const row of summaries) {
    const settings = settingsByDeck.get(row.project_id);
    const newSupply = Math.max(0, (settings?.newCardsPerDay ?? 20) - row.new_studied_today);
    const newAvailable = Math.min(row.new_card_count, newSupply);
    out[row.project_id] = row.due_count + newAvailable;
  }
  return out;
}

export function studyOptionsFromSummaries(
  summaries: StudyDeckSummaryRow[],
  projects: Array<{ id: string; name: string; deck_name: string | null; settings: unknown }>,
): StudyDeckOption[] {
  const settingsById = new Map(projects.map((p) => [p.id, settingsFromRecord(p.settings)]));
  const titleById = new Map(projects.map((p) => [p.id, p.deck_name || p.name]));

  return summaries.map((row) => {
    const settings = settingsById.get(row.project_id);
    const newSupply = Math.max(0, (settings?.newCardsPerDay ?? 20) - row.new_studied_today);
    const newAvailable = Math.min(row.new_card_count, newSupply);
    return {
      id: row.project_id,
      title: titleById.get(row.project_id) ?? "Deck",
      due: row.due_count,
      new: newAvailable,
      waiting: row.due_count + newAvailable,
    };
  });
}
