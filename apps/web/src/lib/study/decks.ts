import type { SupabaseClient } from "@supabase/supabase-js";
import { settingsFromRecord } from "@/lib/fsrs/settings";
import { buildStudySessionQueue, countNewReviewsTodayForDeck } from "@/lib/study/queue";

export type StudyDeckOption = {
  id: string;
  title: string;
  due: number;
  new: number;
  /** Due + new available in today's session budget. */
  waiting: number;
};

export async function getStudyDeckOptions(
  supabase: SupabaseClient,
  userId: string,
): Promise<StudyDeckOption[]> {
  const { data: projects, error } = await supabase
    .from("projects")
    .select("id, name, deck_name, settings")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  if (!projects?.length) return [];

  const nowIso = new Date().toISOString();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const summaries = await Promise.all(
    projects.map(async (project) => {
      const { count: cardCount } = await supabase
        .from("cards")
        .select("id, generation_jobs!inner(sources!inner(project_id))", {
          count: "exact",
          head: true,
        })
        .eq("generation_jobs.sources.project_id", project.id);

      if (!cardCount) return null;

      const settings = settingsFromRecord(project.settings);
      const newToday = await countNewReviewsTodayForDeck(
        supabase,
        project.id,
        userId,
        startOfDay.toISOString(),
      );
      const newSupply = Math.max(0, settings.newCardsPerDay - newToday);
      const session = await buildStudySessionQueue(
        supabase,
        project.id,
        userId,
        nowIso,
        newSupply,
      );

      const newAvailable = Math.min(session.newTotal, newSupply);

      return {
        id: project.id,
        title: project.deck_name || project.name,
        due: session.due.length,
        new: newAvailable,
        waiting: session.due.length + newAvailable,
      } satisfies StudyDeckOption;
    }),
  );

  return summaries.filter((row): row is StudyDeckOption => row != null);
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
