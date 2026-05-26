export const MAX_CLOZE_ID = 9;

export const CLOZE_IDS = Array.from(
  { length: MAX_CLOZE_ID },
  (_, index) => `c${index + 1}`,
) as readonly string[];

export type ClozeId = (typeof CLOZE_IDS)[number];

export function clozeNumber(id: string): number {
  const n = Number.parseInt(String(id).replace(/^c/i, ""), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export function clozeClassName(id: string): string {
  const n = Math.min(Math.max(clozeNumber(id), 1), MAX_CLOZE_ID);
  return `dh-cloze dh-cloze--c${n}`;
}

export function isValidClozeId(id: string): id is ClozeId {
  return CLOZE_IDS.includes(id as ClozeId);
}
