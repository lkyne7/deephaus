import {
  DETAIL_LEVEL_CARDS_PER_1K,
  TOPIC_DETAIL_LEVEL_CARD_COUNT,
  detailLevelInstructions,
  parseGenerationSettings,
  resolveFocusInstruction,
  type CardMix,
  type GenerationSettings,
  type TextChunk,
} from "@deephaus/shared";

const FLAT_TAG_RULES =
  "- Add one or more flat tags per card that describe the subject matter or topic the card is about (e.g. Cardiology, Biology, Algebra, Photosynthesis, French Revolution). Prefer broad, reusable subject/topic labels over hyper-specific ones. Never use :: or hierarchical/subtag notation. Never use page numbers, slide numbers, figure or section references, file names, timestamps, or any other source/location metadata as tags — tags must describe what the card is about, not where it came from.";

const NO_TAG_RULES =
  "- Do not add tags. Return an empty tags array on every card.";

const MARKDOWN_LATEX_RULES = `- Card text supports lightweight Markdown (bold **text**, italic *text*, inline code, lists) and LaTeX math.
- Use $...$ for inline math and $$...$$ for display/block math (KaTeX). Prefer LaTeX for equations, formulas, chemical notation, and symbols instead of Unicode approximations.
- Do not wrap whole cards in HTML. Prefer Markdown/LaTeX over raw HTML except for literal <br> line breaks when needed.`;

/**
 * Cloze hint guidance. When enabled, every cloze deletion must include a hint;
 * when disabled, deletions must use plain `{{c1::answer}}` syntax only.
 */
function clozeHintRule(enabled: boolean): string {
  return enabled
    ? "- Add a short hint to EVERY cloze deletion using {{c1::answer::hint}} syntax (the hint is a third segment after a second ::). Each deletion on the card must have its own hint — never leave any as plain {{c1::answer}}. Keep hints to 1-3 words that help recall without giving away the answer."
    : "- Do not add hints to cloze deletions. Use plain {{c1::answer}} syntax with no second :: segment on every deletion.";
}

/** Cloze syntax example, optionally demonstrating the `::hint` segment. */
function clozeSyntaxExample(hintsEnabled: boolean): string {
  return hintsEnabled
    ? `Use {{c1::hidden term}} syntax with double colons and double closing braces. Every cloze deletion must include a hint as a third segment: {{c1::answer::hint}}.
Example clozeText: "The {{c1::mitochondria::organelle}} is the powerhouse of the {{c2::cell::unit of life}}."`
    : `Use {{c1::hidden term}} syntax with double colons and double closing braces.
Example clozeText: "The {{c1::mitochondria}} is the powerhouse of the {{c2::cell}}."`;
}

export interface BuildSystemPromptOptions {
  /** Force a single card type for this call, overriding the resolved cardTypes. */
  forceType?: CardMix;
  /** Scale the target card count (e.g. 0.5 when splitting a budget across types). */
  cardCountScale?: number;
}

export function buildSystemPrompt(
  settings: GenerationSettings,
  opts: BuildSystemPromptOptions = {},
): string {
  const normalized = parseGenerationSettings(settings);
  const { detailLevel } = normalized;
  const cardTypes = opts.forceType ? [opts.forceType] : normalized.cardTypes;
  const cardsPer1k = Math.max(
    1,
    Math.round(DETAIL_LEVEL_CARDS_PER_1K[detailLevel] * (opts.cardCountScale ?? 1)),
  );

  const wantsBasic = cardTypes.includes("basic");
  const wantsCloze = cardTypes.includes("cloze");
  const wantsBoth = wantsBasic && wantsCloze;
  const hintsOn = wantsCloze && normalized.clozeHints;

  const clozeSyntax = clozeSyntaxExample(hintsOn);

  const mixInstructions = wantsBoth
    ? `Generate BOTH front/back (basic) AND fill-in-the-blank (cloze) cards. You MUST include a meaningful number of each type — aim for a roughly even split (close to 50/50) and never return only one type. Use "basic" for conceptual Q&A and "cloze" for memorizing key terms in context, but ensure both styles are well represented across the cards you return. ${clozeSyntax}`
    : wantsCloze
      ? `Generate ONLY fill-in-the-blank (cloze) deletion cards. Every card must have type "cloze" with clozeText (front) and optional extra (back) fields.
${clozeSyntax}`
      : 'Generate ONLY front/back (basic) Q&A cards. Every card must have type "basic" with front and back fields only.';

  const fieldRules = wantsBoth
    ? "- Basic cards use front (question) and back (answer). Cloze cards use clozeText for the front and optional extra for the back. Never mix the two field styles on one card."
    : wantsCloze
      ? "- Cloze cards use clozeText for the front and extra for the back (explanation shown on reveal). Leave extra empty if not needed."
      : "- Basic cards have exactly two content fields: front (question) and back (answer). Do not use extra.";

  const focusInstruction = resolveFocusInstruction(settings);
  const focus = focusInstruction
    ? `Focus: ${focusInstruction}`
    : "Focus on high-yield facts suitable for spaced repetition.";

  const clozeRules = wantsCloze
    ? `- For cloze cards: use {{c1::...}} through {{c7::...}} syntax. Never use c8 or higher.
- Max 7 cloze deletions per card.
${clozeHintRule(normalized.clozeHints)}`
    : "";

  return `You are an expert Anki flashcard author. Generate flashcards from study material.

Rules:
- ${mixInstructions}
- ${fieldRules}
- Target roughly ${cardsPer1k} cards per 1000 words of source text.
- ${detailLevelInstructions(detailLevel)}
- ${focus}
${clozeRules ? `${clozeRules}\n` : ""}- For EVERY card, set sourceQuote to a short excerpt (one sentence, max ~40 words) copied VERBATIM from the study material that the card is based on. Copy the characters exactly as they appear — do not paraphrase, fix hyphenation/line-break artifacts, or normalize punctuation — so the quote can be located in the source text.
${MARKDOWN_LATEX_RULES}
- Escape < and > as HTML entities (&lt; &gt;) when they appear as literal text.
- Use <br> for line breaks in HTML fields.
- ${normalized.autoTags ? FLAT_TAG_RULES : NO_TAG_RULES}
- Do not invent facts not supported by the source text.
- Return valid JSON matching the schema exactly.`;
}

export function buildUserPrompt(
  chunk: TextChunk,
  opts: { autoTags?: boolean } = {},
): string {
  const tagsLine =
    opts.autoTags === false
      ? "Leave the tags array empty on every card."
      : "Include flat tags for the topic and source (no :: notation).";
  return `Source reference: ${chunk.sourceRef}

Study material:
"""
${chunk.text}
"""

Generate flashcards from this material. ${tagsLine}`;
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

function topicMixInstructions(
  cardTypes: CardMix[],
  opts: BuildSystemPromptOptions,
  hintsEnabled: boolean,
): { mixInstructions: string; fieldRules: string } {
  const types = opts.forceType ? [opts.forceType] : cardTypes;
  const wantsBasic = types.includes("basic");
  const wantsCloze = types.includes("cloze");
  const wantsBoth = wantsBasic && wantsCloze;

  const clozeSyntax = clozeSyntaxExample(wantsCloze && hintsEnabled);

  const mixInstructions = wantsBoth
    ? `Generate BOTH front/back (basic) AND fill-in-the-blank (cloze) cards. Include a meaningful number of each type — aim for a roughly even split. ${clozeSyntax}`
    : wantsCloze
      ? `Generate ONLY fill-in-the-blank (cloze) deletion cards. Every card must have type "cloze".
${clozeSyntax}`
      : 'Generate ONLY front/back (basic) Q&A cards. Every card must have type "basic".';

  const fieldRules = wantsBoth
    ? "- Basic cards use front (question) and back (answer). Cloze cards use clozeText and optional extra. Never mix field styles on one card."
    : wantsCloze
      ? "- Cloze cards use clozeText for the front and extra for the back when helpful."
      : "- Basic cards have exactly two content fields: front (question) and back (answer). Do not use extra.";

  return { mixInstructions, fieldRules };
}

export function buildTopicSystemPrompt(
  settings: GenerationSettings,
  opts: BuildSystemPromptOptions = {},
): string {
  const normalized = parseGenerationSettings(settings);
  const { detailLevel } = normalized;
  const cardTypes = opts.forceType ? [opts.forceType] : normalized.cardTypes;
  const targetCards = Math.max(
    1,
    Math.round(TOPIC_DETAIL_LEVEL_CARD_COUNT[detailLevel] * (opts.cardCountScale ?? 1)),
  );
  const wantsCloze = cardTypes.includes("cloze");
  const { mixInstructions, fieldRules } = topicMixInstructions(
    cardTypes,
    opts,
    normalized.clozeHints,
  );

  const focusInstruction = resolveFocusInstruction(settings);
  const focus = focusInstruction
    ? `Focus: ${focusInstruction}`
    : "Focus on high-yield facts suitable for spaced repetition.";

  const clozeRules = wantsCloze
    ? `- For cloze cards: use {{c1::...}} through {{c7::...}} syntax. Never use c8 or higher.
- Max 7 cloze deletions per card.
${clozeHintRule(normalized.clozeHints)}`
    : "";

  return `You are an expert Anki flashcard author. Generate flashcards about a topic using accurate, widely accepted knowledge.

Rules:
- ${mixInstructions}
- ${fieldRules}
- Generate exactly ${targetCards} cards (or as close as possible without sacrificing quality).
- ${detailLevelInstructions(detailLevel)}
- ${focus}
${clozeRules ? `${clozeRules}\n` : ""}- Set sourceQuote to null on every card (topic decks have no source document).
${MARKDOWN_LATEX_RULES}
- Escape < and > as HTML entities (&lt; &gt;) when they appear as literal text.
- Use <br> for line breaks in HTML fields.
- ${normalized.autoTags ? FLAT_TAG_RULES : NO_TAG_RULES}
- Stick to established facts; if something is disputed, prefer the consensus view or note uncertainty in extra.
- Return valid JSON matching the schema exactly.`;
}

export function buildTopicUserPrompt(
  topic: string,
  opts: { autoTags?: boolean } = {},
): string {
  const tagsLine =
    opts.autoTags === false
      ? "Leave the tags array empty on every card."
      : "Include flat tags for the topic (no :: notation).";
  return `Topic to generate flashcards about:
"""
${topic.trim()}
"""

Create flashcards covering the most important facts someone studying this topic should memorize. ${tagsLine}`;
}
