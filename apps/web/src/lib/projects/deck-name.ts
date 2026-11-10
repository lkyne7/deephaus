import { z } from "zod";

export const MAX_DECK_NAME_LENGTH = 120;

/** Deck names on create, rename and import: trimmed, non-empty, at most 120 characters. */
export const deckNameSchema = z
  .string({ required_error: "Deck name is required.", invalid_type_error: "Deck name must be text." })
  .trim()
  .min(1, "Deck name cannot be empty.")
  .max(MAX_DECK_NAME_LENGTH, `Deck name must be ${MAX_DECK_NAME_LENGTH} characters or fewer.`);

/** Fit a suggested name (file name, page title…) within the deck-name limit. */
export function fitDeckName(name: string, fallback: string): string {
  const trimmed = name.trim();
  if (!trimmed) return fallback;
  if (trimmed.length <= MAX_DECK_NAME_LENGTH) return trimmed;
  return `${trimmed.slice(0, MAX_DECK_NAME_LENGTH - 1).trimEnd()}…`;
}

/** The first validation message from a zod error, for a 400 response. */
export function firstIssueMessage(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
