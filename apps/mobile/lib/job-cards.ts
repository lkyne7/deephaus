import type { BrowseCardRow } from "@deephaus/api-client";
import { offlineData } from "@/lib/offline-data";

const PAGE_SIZE = 100;

/**
 * The cards a generation job added to a deck. Deck order puts the newest batch
 * first, so this reads from the top and stops once every card is found, or at
 * `limit` for a preview.
 */
export async function loadJobCards(
  deckId: string,
  jobId: string,
  limit = Number.POSITIVE_INFINITY,
): Promise<{ cards: BrowseCardRow[]; ids: string[] }> {
  const ids = await offlineData.listJobCardIds(jobId);
  const wanted = new Set(ids);
  const target = Math.min(ids.length, limit);
  const cards: BrowseCardRow[] = [];

  for (let offset = 0; cards.length < target; offset += PAGE_SIZE) {
    const page = await offlineData.browseCards({ deck_id: deckId, limit: PAGE_SIZE, offset });
    cards.push(...page.cards.filter((card) => wanted.has(card.id)));
    if (page.cards.length === 0 || offset + PAGE_SIZE >= page.total) break;
  }

  return { cards: cards.slice(0, target), ids };
}
