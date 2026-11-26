/**
 * How the card browser orders cards, on the web and the phone alike. Drawn from
 * the columns Anki's browser sorts by: Sort Field (A–Z), Created, Due, Lapses
 * and Difficulty, plus the deck's own order. The `browse_cards` RPC and the
 * phone's local query (packages/local-db browse.ts) implement each one, and
 * break ties by deck order.
 */
export type CardSort = "deck" | "newest" | "oldest" | "alpha" | "due" | "lapses" | "difficulty";

export type CardSortOption = {
  value: CardSort;
  label: string;
  description: string;
};

export const CARD_SORT_OPTIONS: CardSortOption[] = [
  { value: "deck", label: "Deck order", description: "Each deck in the order its cards were made" },
  { value: "newest", label: "Newest first", description: "Most recently added" },
  { value: "oldest", label: "Oldest first", description: "First added" },
  { value: "alpha", label: "A–Z", description: "By question" },
  { value: "due", label: "Due soonest", description: "Next review first, new cards last" },
  { value: "lapses", label: "Most forgotten", description: "Most lapses first" },
  { value: "difficulty", label: "Hardest first", description: "Highest FSRS difficulty first" },
];

export const DEFAULT_CARD_SORT: CardSort = "deck";

export function isCardSort(value: unknown): value is CardSort {
  return CARD_SORT_OPTIONS.some((option) => option.value === value);
}
