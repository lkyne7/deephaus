import type { CardMix, CardType, DetailLevel } from "./schemas.js";

/** Per-card editor type control (basic, cloze, image occlusion). */
export const CARD_EDITOR_TYPE_OPTIONS: Array<{
  value: CardType;
  shortLabel: string;
  icon: string;
}> = [
  { value: "basic", shortLabel: "Front/Back", icon: "ri-question-answer-line" },
  { value: "cloze", shortLabel: "Fill-in-the-Blank", icon: "ri-input-method-line" },
  { value: "image-occlusion", shortLabel: "Occlusion", icon: "ri-image-line" },
];

export const CARD_MIX_OPTIONS: Array<{ value: CardMix; label: string }> = [
  { value: "basic", label: "Front/Back (Basic)" },
  { value: "cloze", label: "Fill-in-the-Blank (Cloze)" },
];

export const DETAIL_LEVEL_OPTIONS: Array<{ value: DetailLevel; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];

export function cardMixLabel(mix: CardMix): string {
  return CARD_MIX_OPTIONS.find((o) => o.value === mix)?.label ?? mix;
}

export function cardTypeLabel(type: CardType, style: "full" | "short" = "full"): string {
  if (style === "short") {
    return CARD_EDITOR_TYPE_OPTIONS.find((o) => o.value === type)?.shortLabel ?? type;
  }
  if (type === "basic") return "Front/Back";
  if (type === "image-occlusion") return "Occlusion";
  return "Fill-in-the-Blank";
}

export function detailLevelLabel(level: DetailLevel): string {
  return DETAIL_LEVEL_OPTIONS.find((o) => o.value === level)?.label ?? level;
}

/** Target card count per 1,000 words of source text. */
export const DETAIL_LEVEL_CARDS_PER_1K: Record<DetailLevel, number> = {
  low: 2,
  medium: 5,
  high: 10,
};

export function resolveDetailLevel(settings: {
  detailLevel?: DetailLevel;
  density?: number;
}): DetailLevel {
  if (settings.detailLevel) return settings.detailLevel;
  const density = settings.density ?? 5;
  if (density <= 3) return "low";
  if (density <= 7) return "medium";
  return "high";
}

export function detailLevelInstructions(level: DetailLevel): string {
  switch (level) {
    case "low":
      return "Detail level: LOW. Keep each card minimal — short question, short answer, and little or no extra context. Cover only the highest-yield facts.";
    case "high":
      return "Detail level: HIGH. Be thorough — finer-grained facts, richer answers, and useful context in the extra field (examples, brief explanations, source quotes when helpful).";
    default:
      return "Detail level: MEDIUM. Balance brevity with enough context to learn from each card. Include extra notes when they aid recall.";
  }
}

export function normalizeCardMix(mix: string | undefined): CardMix {
  if (mix === "cloze") return "cloze";
  return "basic";
}
