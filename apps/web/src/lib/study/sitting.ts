import { createSitting } from "@deephaus/shared";
import type { StudyCardData } from "@/components/study-card-panel";

/** A card as the finish page shows it again. */
export type SittingCard = StudyCardData & {
  cloze_ord: number | null;
  deck_id: string;
  lapses: number;
};

/** This tab's answers across sessions. Cleared with the review queue cache on every sign-in change. */
export const studySitting = createSitting<SittingCard>();
