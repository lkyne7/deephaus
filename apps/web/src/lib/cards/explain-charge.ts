import "server-only";
import { NextResponse } from "next/server";
import { TutorError } from "@deephaus/llm";
import {
  aiCreditsExhaustedResponse,
  creditIdempotencyKey,
  isAiCreditsExhaustedError,
  releaseAiCredits,
  reserveAiCredits,
  settleAiCredits,
} from "@/lib/credits/service";

/**
 * Runs one paid tutor call: reserve 1 credit, do the work, settle; release on
 * any failure. `charge: false` (mock mode) skips credits entirely. Returns the
 * work's result, or a Response to send instead (402 when out of credits, 502
 * when the tutor failed, 500 otherwise).
 */
export async function runChargedTutorCall<T>(options: {
  request: Request;
  userId: string;
  action: "card-explain" | "card-hint" | "card-explain-ask";
  operation: string;
  cardId: string;
  charge: boolean;
  work: () => Promise<T>;
}): Promise<{ result: T } | { response: Response }> {
  const idempotencyKey = creditIdempotencyKey(
    options.userId,
    options.operation,
    options.request.headers.get("idempotency-key"),
  );
  let reserved = false;
  try {
    if (options.charge) {
      await reserveAiCredits({
        userId: options.userId,
        idempotencyKey,
        action: options.action,
        reservedCredits: 1,
        resourceType: "card",
        resourceId: options.cardId,
      });
      reserved = true;
    }
    const result = await options.work();
    if (reserved) {
      await settleAiCredits({ userId: options.userId, idempotencyKey, chargedCredits: 1 });
    }
    return { result };
  } catch (err) {
    if (reserved) {
      try {
        await releaseAiCredits({ userId: options.userId, idempotencyKey });
      } catch (releaseError) {
        console.error(`[${options.action}] failed to release credit reservation`, releaseError);
      }
    }
    if (isAiCreditsExhaustedError(err)) return { response: aiCreditsExhaustedResponse(err) };
    const message = err instanceof Error ? err.message : "Something went wrong.";
    if (err instanceof TutorError) {
      return { response: NextResponse.json({ error: message }, { status: 502 }) };
    }
    console.error(`[${options.action}]`, err);
    return { response: NextResponse.json({ error: message }, { status: 500 }) };
  }
}
