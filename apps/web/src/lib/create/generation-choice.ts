import {
  parseGenerationSettings,
  type CardMix,
  type DetailLevel,
  type FocusPreset,
} from "@deephaus/shared";

/** The generation controls in Create: what a deck remembers between runs. */
export type GenerationChoice = {
  detailLevel: DetailLevel;
  cardTypes: CardMix[];
  focusPreset: FocusPreset;
  clozeHints: boolean;
  autoTags: boolean;
};

const NEW_DECK_KEY = "deephaus.create.newDeckChoice";

/** The choice a deck's stored settings describe. */
export function choiceFromSettings(raw: unknown, fallbackFocus: FocusPreset): GenerationChoice {
  const parsed = parseGenerationSettings(raw ?? {});
  return {
    detailLevel: parsed.detailLevel,
    cardTypes: parsed.cardTypes.length > 0 ? parsed.cardTypes : ["basic"],
    focusPreset: parsed.focusPreset ?? fallbackFocus,
    clozeHints: parsed.clozeHints,
    autoTags: parsed.autoTags,
  };
}

/** The last choice made while starting a new deck, in this browser. */
export function readNewDeckChoice(fallbackFocus: FocusPreset): GenerationChoice | null {
  try {
    const stored = window.localStorage.getItem(NEW_DECK_KEY);
    return stored ? choiceFromSettings(JSON.parse(stored), fallbackFocus) : null;
  } catch {
    return null;
  }
}

export function writeNewDeckChoice(choice: GenerationChoice): void {
  try {
    window.localStorage.setItem(NEW_DECK_KEY, JSON.stringify(choice));
  } catch {
    // Without storage, new decks start from the defaults.
  }
}

/** Fields the deck PATCH accepts; `cardMix` keeps older clients reading the right type. */
export function choiceSettingsPatch(choice: GenerationChoice) {
  return { ...choice, cardMix: choice.cardTypes[0] ?? "basic" };
}
