/** Rough per-card review pace used only for the "About N minutes" estimate. */
const SECONDS_PER_CARD = 9;

/** Human-friendly study-time estimate ("7 minutes" / "2h 30m"). */
export function estimateStudyDuration(cards: number): string {
  const minutes = Math.max(1, Math.round((cards * SECONDS_PER_CARD) / 60));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  return rem === 0 ? `${hours}h` : `${hours}h ${rem}m`;
}

type HomeDeck = {
  deck_id: string;
  due: number;
  new: number;
  new_card_count: number;
  last_reviewed: string | null;
};

const LIST_LENGTH = 3;

const recency = (deck: HomeDeck) => (deck.last_reviewed ? Date.parse(deck.last_reviewed) : 0);

/** Decks with due cards, most due first, for "Pick up where you left off". */
export function pickContinueDecks<D extends HomeDeck>(decks: D[]): D[] {
  return decks
    .filter((deck) => deck.due > 0)
    .sort((a, b) => b.due - a.due || recency(b) - recency(a))
    .slice(0, LIST_LENGTH);
}

/** Decks studied most recently, for the caught-up state. */
export function pickRecentDecks<D extends HomeDeck>(decks: D[]): D[] {
  return decks
    .filter((deck) => deck.last_reviewed !== null)
    .sort((a, b) => recency(b) - recency(a))
    .slice(0, LIST_LENGTH);
}

/**
 * When the next cards arrive, for the caught-up state. New cards held back by a
 * daily limit return with the next study day; otherwise the forecast decides.
 */
export function nextCardsLabel(
  decks: HomeDeck[],
  forecast: Record<string, number>,
  todayKey: string,
): string | null {
  if (decks.some((deck) => deck.new_card_count > 0)) return "next cards tomorrow morning";
  const next = Object.keys(forecast)
    .filter((key) => key > todayKey && forecast[key] > 0)
    .sort()[0];
  if (!next) return null;
  const today = new Date(`${todayKey}T00:00:00`);
  const date = new Date(`${next}T00:00:00`);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days === 1) return "next cards tomorrow";
  return `next cards ${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
}
