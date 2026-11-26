import type { SupabaseClient } from "@supabase/supabase-js";
import { buildStudyFinishDecks, studyDayBounds, type UpcomingReview } from "@deephaus/scheduling";
import type { StudyFinishResponse } from "@deephaus/shared";
import { fetchUserProjects } from "@/lib/data/server-auth";
import { resolveEffectiveDeckSettings, settingsFromRecord } from "@/lib/fsrs/settings";
import { loadGlobalStudySettings } from "@/lib/fsrs/user-study-settings";
import { fetchStudyDeckSummaries } from "@/lib/study/deck-summaries";

const PAGE = 1000;

function projectIdOf(row: Record<string, unknown>): string | null {
  const one = (value: unknown) => (Array.isArray(value) ? value[0] : value);
  const card = one(row.cards) as Record<string, unknown> | undefined;
  const job = one(card?.generation_jobs) as Record<string, unknown> | undefined;
  const source = one(job?.sources) as Record<string, unknown> | undefined;
  return typeof source?.project_id === "string" ? source.project_id : null;
}

/** Every card not due yet but due by the end of tomorrow, across decks. */
async function fetchUpcomingReviews(
  supabase: SupabaseClient,
  userId: string,
  nowIso: string,
  untilIso: string,
): Promise<UpcomingReview[]> {
  const out: UpcomingReview[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("card_reviews")
      .select(
        "card_id, cloze_ord, due, state, last_review, cards!inner ( generation_jobs!inner ( sources!inner ( project_id ) ) )",
      )
      .eq("user_id", userId)
      .eq("suspended", false)
      .neq("state", 0)
      .gt("due", nowIso)
      .lt("due", untilIso)
      // A total order, so pages neither repeat nor skip cards due together.
      .order("due")
      .order("card_id")
      .order("cloze_ord")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    for (const raw of (data ?? []) as Array<Record<string, unknown>>) {
      const deckId = projectIdOf(raw);
      if (!deckId) continue;
      out.push({
        deckId,
        cardId: String(raw.card_id),
        due: String(raw.due),
        state: Number(raw.state),
        lastReview: (raw.last_review as string | null) ?? null,
      });
    }
    if (!data || data.length < PAGE) return out;
  }
}

export async function getStudyFinish(
  supabase: SupabaseClient,
  userId: string,
  now = new Date(),
): Promise<StudyFinishResponse> {
  const global = await loadGlobalStudySettings(supabase, userId);
  const bounds = studyDayBounds(now, global.dayStartHour, global.timezone);
  const [projects, summaries, upcoming] = await Promise.all([
    fetchUserProjects(supabase, userId),
    fetchStudyDeckSummaries(supabase, userId, bounds.start.toISOString()),
    fetchUpcomingReviews(supabase, userId, now.toISOString(), bounds.endOfTomorrow.toISOString()),
  ]);
  const projectById = new Map(projects.map((project) => [project.id, project]));
  return {
    decks: buildStudyFinishDecks(
      (summaries ?? []).flatMap((summary) => {
        const project = projectById.get(summary.project_id);
        if (!project || summary.card_count === 0) return [];
        const settings = resolveEffectiveDeckSettings(settingsFromRecord(project.settings), global);
        return [
          {
            id: project.id,
            title: project.deck_name || project.name,
            cardCount: summary.card_count,
            paused: settings.paused === true,
            newCardsPerDay: settings.newCardsPerDay,
            reviewOrder: settings.reviewOrder,
            summary,
          },
        ];
      }),
      upcoming,
      bounds,
    ),
  };
}
