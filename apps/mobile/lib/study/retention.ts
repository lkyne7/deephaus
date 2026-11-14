import { DEFAULT_DESIRED_RETENTION } from "@deephaus/shared";

/** Desired retention range the scheduler accepts, in percent. */
export const RETENTION_MIN_PCT = 70;
export const RETENTION_MAX_PCT = 97;
/** The default, and what the slider recommends. */
export const RECOMMENDED_RETENTION_PCT = Math.round(DEFAULT_DESIRED_RETENTION * 100);

/** New cards a deck can introduce in a day (the deck settings schema's limit). */
export const NEW_CARDS_PER_DAY_MAX = 200;

/** One line under the retention slider, saying what the chosen value trades. */
export function retentionHint(pct: number): string {
  if (pct === RECOMMENDED_RETENTION_PCT) return "Best balance of recall and review time.";
  if (pct > RECOMMENDED_RETENTION_PCT) return "More reviews for a little more recall.";
  return "Fewer reviews, but you'll forget more.";
}

export function clampRetentionPct(pct: number): number {
  if (!Number.isFinite(pct)) return RECOMMENDED_RETENTION_PCT;
  return Math.max(RETENTION_MIN_PCT, Math.min(RETENTION_MAX_PCT, Math.round(pct)));
}
