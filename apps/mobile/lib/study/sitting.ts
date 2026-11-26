import { createSitting } from "@deephaus/shared";
import type { SessionCard } from "@/lib/study/session";

/** Answers across sessions, for the finish page. Cleared when the account changes. */
export const studySitting = createSitting<SessionCard>();
