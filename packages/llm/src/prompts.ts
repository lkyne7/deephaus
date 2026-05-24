import type { CardMix, GenerationSettings, TextChunk } from "@sluggo/shared";

export function buildSystemPrompt(settings: GenerationSettings): string {
  const mixInstructions =
    settings.cardMix === "basic"
      ? "Generate only basic front/back Q&A cards."
      : settings.cardMix === "cloze"
        ? "Generate only cloze deletion cards."
        : "Mix basic Q&A cards and cloze deletion cards.";

  const focus = settings.focusPrompt
    ? `Focus: ${settings.focusPrompt}`
    : "Focus on high-yield facts suitable for spaced repetition.";

  return `You are an expert Anki flashcard author. Generate flashcards from study material.

Rules:
- ${mixInstructions}
- Target roughly ${settings.density} cards per 1000 words of source text.
- ${focus}
- For cloze cards: use {{c1::...}}, {{c2::...}}, {{c3::...}} syntax. Never use c4 or higher.
- Max 3 cloze deletions per card.
- Escape < and > as HTML entities (&lt; &gt;) when they appear as literal text.
- Use <br> for line breaks in HTML fields.
- Include an "extra" field citing the source section.
- Tags should be hierarchical using :: (e.g. PDF::Page12, Topic::Subtopic).
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
      return "basic cards only";
    case "cloze":
      return "cloze cards only";
    default:
      return "a mix of basic and cloze cards";
  }
}
