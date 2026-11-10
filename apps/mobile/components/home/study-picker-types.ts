import type { RecentDeck } from "@/lib/recent-decks";

export type StudyPickerProps = {
  /** Decks to choose from, most recent first. */
  decks: RecentDeck[];
  selected: RecentDeck;
  onSelect: (deck: RecentDeck) => void;
  onStudy: () => void;
};

/** The short count on the picker itself: what studying now would start with. */
export function shortCount(deck: RecentDeck): string {
  if (deck.due > 0) return `${deck.due} due`;
  if (deck.fresh > 0) return `${deck.fresh} new`;
  return "Done";
}

/** Both counts, for menu rows and VoiceOver. */
export function fullCount(deck: RecentDeck): string {
  if (deck.due + deck.fresh === 0) return "Nothing to study today";
  return [deck.due > 0 ? `${deck.due} due` : null, deck.fresh > 0 ? `${deck.fresh} new` : null]
    .filter(Boolean)
    .join(" · ");
}
