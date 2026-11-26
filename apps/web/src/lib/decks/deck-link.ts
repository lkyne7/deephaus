/**
 * A deck lives in the Decks page's side pane, not on a page of its own. These
 * build the links that open it there, optionally on one of the pane's views.
 */

export const DECK_PANE_VIEWS = ["settings", "sharing", "forecast"] as const;

/** A view in the deck's side pane other than its summary. */
export type DeckPaneView = (typeof DECK_PANE_VIEWS)[number];

export function parseDeckPaneView(value: string | null | undefined): DeckPaneView | null {
  return DECK_PANE_VIEWS.includes(value as DeckPaneView) ? (value as DeckPaneView) : null;
}

/** `/decks?deck=<id>`, plus `&panel=<view>` to open the pane on that view. */
export function deckHref(deckId: string, view?: DeckPaneView | null): string {
  const params = new URLSearchParams({ deck: deckId });
  if (view) params.set("panel", view);
  return `/decks?${params}`;
}
