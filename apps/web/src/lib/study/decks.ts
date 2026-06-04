import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserProjects } from "@/lib/data/server-auth";
import {
  fetchStudyDeckSummaries,
  studyOptionsFromSummaries,
  type StudyDeckSummaryRow,
} from "@/lib/study/deck-summaries";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import {
  countDueStudyCards,
  countNewReviewsTodayForDeck,
  countNewStudyCards,
} from "@/lib/study/queue";

export type StudyDeckOption = {
  id: string;
  title: string;
  due: number;
  new: number;
  /** Due + new available in today's session budget. */
  waiting: number;
};

async function getStudyDeckOptionsLegacy(
  supabase: SupabaseClient,
  userId: string,
  projects: Awaited<ReturnType<typeof getUserProjects>>,
): Promise<StudyDeckOption[]> {
  const nowIso = new Date().toISOString();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const startOfDayIso = startOfDay.toISOString();

  const { data: cardCountRows } = await supabase.rpc("count_cards_by_projects", {
    p_project_ids: projects.map((p) => p.id),
  });
  const cardCountById = new Map<string, number>(
    ((cardCountRows ?? []) as Array<{ project_id: string; card_count: number }>).map((row) => [
      row.project_id,
      Number(row.card_count),
    ]),
  );

  const summaries = await Promise.all(
    projects.map(async (project) => {
      if (!cardCountById.get(project.id)) return null;

      const settings = settingsFromRecord(project.settings);
      const [newToday, due, newCount] = await Promise.all([
        countNewReviewsTodayForDeck(supabase, project.id, userId, startOfDayIso),
        countDueStudyCards(supabase, project.id, userId, nowIso),
        countNewStudyCards(supabase, project.id, userId),
      ]);

      const newSupply = Math.max(0, settings.newCardsPerDay - newToday);
      const newAvailable = Math.min(newCount, newSupply);

      return {
        id: project.id,
        title: project.deck_name || project.name,
        due,
        new: newAvailable,
        waiting: due + newAvailable,
      } satisfies StudyDeckOption;
    }),
  );

  return summaries.filter((row): row is StudyDeckOption => row != null);
}

export async function getStudyDeckOptions(
  supabase: SupabaseClient,
  userId: string,
  projects?: Awaited<ReturnType<typeof getUserProjects>>,
): Promise<StudyDeckOption[]> {
  const deckRows = projects ?? (await getUserProjects(userId));
  if (!deckRows.length) return [];

  const summaries = await fetchStudyDeckSummaries(supabase, userId);
  if (summaries) {
    return studyOptionsFromSummaries(summaries, deckRows);
  }
  return getStudyDeckOptionsLegacy(supabase, userId, deckRows);
}

export function pickDefaultStudyDeckId(decks: StudyDeckOption[]): string | null {
  if (decks.length === 0) return null;
  return (
    decks.find((d) => d.due > 0)?.id ??
    decks.find((d) => d.new > 0)?.id ??
    decks.find((d) => d.waiting > 0)?.id ??
    decks[0].id
  );
}
