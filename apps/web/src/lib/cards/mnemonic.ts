/**
 * Shared contract for the per-card one-click AI actions (Create page tiles,
 * card editor):
 *
 *   POST /api/cards/[id]/mnemonic   — rewrite the card as an AnKing-style
 *                                     mnemonic card of the same type
 *   POST /api/cards/[id]/regenerate — rewrite the card from its source
 *
 * Both actions replace the card's content fields in place and return the
 * saved card, so the client can swap it in and offer an undo.
 *
 * Pure types + constants only — safe to import from both route handlers and
 * client components (see card-ai-actions-client.ts for fetch wrappers).
 */

/** Credits charged per mnemonic rewrite. */
export const MNEMONIC_CREDITS = 1;
/** Credits charged per card regeneration. */
export const REGENERATE_CARD_CREDITS = 1;

/** Card types that support the one-click rewrites. */
export const AI_ACTION_CARD_TYPES = ["basic", "cloze"] as const;
export type AiActionCardType = (typeof AI_ACTION_CARD_TYPES)[number];

export function supportsCardAiActions(type: string): type is AiActionCardType {
  return (AI_ACTION_CARD_TYPES as readonly string[]).includes(type);
}

/** The saved card after a rewrite; identical for both actions. */
export type CardRewriteResponse = {
  id: string;
  type: AiActionCardType;
  front: string | null;
  back: string | null;
  cloze_text: string | null;
  extra: string | null;
  tags: string[];
  user_edited: boolean;
  updated_at: string;
};

export type CardMnemonicResponse = CardRewriteResponse;
export type RegenerateCardResponse = CardRewriteResponse;
