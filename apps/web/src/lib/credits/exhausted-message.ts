/**
 * Client-safe detection of "out of AI credits" failures from error strings.
 * Server code raises `AI_CREDITS_EXHAUSTED:*` and API routes surface
 * "AI credits exhausted." — both should render as a friendly upgrade prompt
 * rather than a raw error string.
 */
export function isAiCreditsExhaustedMessage(message: string | null | undefined): boolean {
  if (!message) return false;
  return (
    message.includes("AI_CREDITS_EXHAUSTED") ||
    /credits (are )?exhausted/i.test(message)
  );
}

export const AI_CREDITS_EXHAUSTED_FRIENDLY_MESSAGE =
  "You've used all of your AI credits for this billing period. Upgrade your plan or wait for the next reset to keep generating cards.";
