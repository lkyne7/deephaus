import {
  DETAIL_LEVEL_CARDS_PER_1K,
  detailLevelInstructions,
  parseGenerationSettings,
  type CardMix,
  type GenerationSettings,
  type TextChunk,
} from "@deephaus/shared";

export function buildSystemPrompt(settings: GenerationSettings): string {
  const normalized = parseGenerationSettings(settings);
  const { cardMix, detailLevel } = normalized;
  const cardsPer1k = DETAIL_LEVEL_CARDS_PER_1K[detailLevel];

  const mixInstructions =
    cardMix === "basic"
      ? 'Generate ONLY front/back (basic) Q&A cards. Every card must have type "basic" with front and back fields only.'
      : `Generate ONLY fill-in-the-blank (cloze) deletion cards. Every card must have type "cloze" with clozeText (front) and optional extra (back) fields.
Example clozeText: "The {{c1::mitochondria}} is the powerhouse of the {{c2::cell}}."
Use {{c1::hidden term}} syntax with double colons and double closing braces.`;

  const fieldRules =
    cardMix === "basic"
      ? "- Basic cards have exactly two content fields: front (question) and back (answer). Do not use extra."
      : "- Cloze cards use clozeText for the front and extra for the back (explanation shown on reveal). Leave extra empty if not needed.";

  const focus = settings.focusPrompt
    ? `Focus: ${settings.focusPrompt}`
    : "Focus on high-yield facts suitable for spaced repetition.";

  return `You are an expert Anki flashcard author. Generate flashcards from study material.

Rules:
- ${mixInstructions}
- ${fieldRules}
- Target roughly ${cardsPer1k} cards per 1000 words of source text.
- ${detailLevelInstructions(detailLevel)}
- ${focus}
- For cloze cards: use {{c1::...}} through {{c9::...}} syntax. Never use c10 or higher.
- Max 9 cloze deletions per card.
- Escape < and > as HTML entities (&lt; &gt;) when they appear as literal text.
- Use <br> for line breaks in HTML fields.
- Tags should be hierarchical using :: (e.g. PDF::Page12, Topic::Subtopic). Put source references in tags, not in card body fields.
- Do not invent facts not supported by the source text.
- Return valid JSON matching the schema exactly.`;
}

export function buildUserPrompt(chunk: TextChunk): string {
  return `Source reference: ${chunk.sourceRef}

Study material:
"""
${chunk.text}
"""

Generate flashcards from this material. Include tags derived from the source reference.`;
}

export function buildCardMixInstruction(cardMix: CardMix): string {
  switch (cardMix) {
    case "basic":
      return "front/back (basic) cards only";
    case "cloze":
      return "fill-in-the-blank (cloze) cards only";
  }
}

export function buildDetailLevelInstruction(settings: GenerationSettings): string {
  return detailLevelInstructions(parseGenerationSettings(settings).detailLevel);
}
