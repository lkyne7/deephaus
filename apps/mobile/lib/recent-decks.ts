import type { DashboardStats } from "@deephaus/api-client";
import type { Project } from "@deephaus/shared";
import { deckDisplayName } from "@/lib/deck-name";

export type RecentDeck = {
  id: string;
  title: string;
  /** Cards due for review now. */
  due: number;
  /** New cards still available today. */
  fresh: number;
};

/**
 * Most recently touched decks first: studied, edited or just made. Counts come
 * from the dashboard stats, recency from whichever of the two is newer. The
 * sidebar's Recent decks and Home's study buttons share this order.
 */
export function recentDecks(
  projects: Project[],
  stats: DashboardStats | null,
  limit = Infinity,
): RecentDeck[] {
  const perDeck = new Map((stats?.per_deck ?? []).map((deck) => [deck.deck_id, deck]));
  return projects
    // A deck with no cards (an empty or abandoned upload) isn't in the Decks
    // list, so Home and the sidebar leave it out too.
    // A paused deck is set aside, so it is left out as well.
    .filter((project) => {
      if (!stats) return true;
      const stat = perDeck.get(project.id);
      return (stat?.total ?? 0) > 0 && !stat?.paused;
    })
    .map((project) => {
      const stat = perDeck.get(project.id);
      const touched = [project.updated_at, stat?.last_reviewed ?? ""].sort().at(-1) ?? "";
      return {
        id: project.id,
        title: deckDisplayName(project.deck_name || project.name),
        due: stat?.due ?? 0,
        fresh: stat?.new ?? 0,
        touched,
      };
    })
    .sort((a, b) => b.touched.localeCompare(a.touched))
    .slice(0, limit)
    .map(({ touched: _touched, ...deck }) => deck);
}
