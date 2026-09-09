/**
 * Shared contract for POST /api/cards/assistant-edit (Create page card
 * assistant). Pure types + constants only — safe to import from both the
 * route handler and client components (see assistant-edit-client.ts for fetch).
 */

/** Hard cap on cards per request (keeps latency + cost bounded). */
export const ASSISTANT_EDIT_MAX_CARDS = 200;
/** One credit per 10 cards (rounded up), minimum one. */
export const ASSISTANT_EDIT_CARDS_PER_CREDIT = 10;

export function assistantEditCredits(cardCount: number): number {
  return Math.max(1, Math.ceil(cardCount / ASSISTANT_EDIT_CARDS_PER_CREDIT));
}

export type AssistantEditRequest = {
  deck_id: string;
  /** Omit to apply to every card in the deck (capped server-side). */
  card_ids?: string[];
  instruction: string;
};

export type AssistantEditUpdatedCard = {
  id: string;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  user_edited: boolean;
  updated_at: string;
};

export type AssistantEditResponse = {
  /** Cards whose content changed, with their new field values. */
  updated: AssistantEditUpdatedCard[];
  /** Cards in scope the model left unchanged or returned invalid edits for. */
  skipped: number;
  /** Number of cards that were in scope. */
  scope: number;
  /** One-line summary of what changed (from the model). */
  summary: string;
};

/** Suggested prompts shown as chips in the assistant composer. */
export const ASSISTANT_EDIT_SUGGESTIONS: ReadonlyArray<{ label: string; prompt: string }> = [
  {
    label: "Make answers more concise",
    prompt: "Make the answers more concise without losing any key facts.",
  },
  {
    label: "Fix typos and grammar",
    prompt: "Fix any spelling, grammar, or punctuation mistakes. Keep the wording otherwise unchanged.",
  },
  {
    label: "Make questions more specific",
    prompt:
      "Rewrite vague questions so they have exactly one unambiguous answer, keeping the same answer.",
  },
  {
    label: "Add exam-topic tags",
    prompt: "Add 1–3 concise topic tags to each card suitable for exam revision. Keep existing tags.",
  },
];