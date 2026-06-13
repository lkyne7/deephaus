import OpenAI from "openai";
import type { LlmConfig } from "./generate.js";
import { formatCardForExplain, type CardExplainInput } from "./explain.js";

/**
 * One-shot AI assistant prompts for the topbar assistant popover.
 * Each function returns markdown. Mock variants (createMock*) are used
 * when no OpenAI API key is configured so dev works offline.
 */

const ASSISTANT_SYSTEM = [
  "You are a concise, encouraging study assistant inside a spaced-repetition flashcard app.",
  "Always answer in short markdown sections with bullet points when helpful.",
  "Never invent facts that are not supported by the provided context.",
  "Keep responses under 250 words unless the task truly requires more.",
].join(" ");

async function runPrompt(user: string, config: LlmConfig, system = ASSISTANT_SYSTEM): Promise<string> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    temperature: 0.4,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || "No response was generated.";
}

function mock(title: string, body: string[]): string {
  return [
    `### ${title}`,
    "",
    "_Placeholder response (no OpenAI API key configured)._",
    "",
    ...body,
  ].join("\n");
}

/* ----------------------------------------------------------------------
 * Card-level actions
 * -------------------------------------------------------------------- */

export async function hintForCard(card: CardExplainInput, config: LlmConfig): Promise<string> {
  const summary = formatCardForExplain(card);
  if (!summary.trim()) return "This card has no content to hint at yet.";

  return runPrompt(
    [
      "Give me a hint for this flashcard WITHOUT revealing the answer.",
      "Point me toward the right mental category, first letter, or a related idea — never the answer itself.",
      "Two or three short bullet points max.",
      "",
      summary,
    ].join("\n"),
    config,
  );
}

export function createMockHint(card: CardExplainInput): string {
  return mock("Hint", [
    "- Think about the broader category this fact belongs to.",
    "- Recall where you first learned it — context often unlocks the answer.",
    `- Card prompt: ${formatCardForExplain(card).split("\n")[0] || "_(empty card)_"}`,
  ]);
}

export async function mnemonicForCard(card: CardExplainInput, config: LlmConfig): Promise<string> {
  const summary = formatCardForExplain(card);
  if (!summary.trim()) return "This card has no content to build a mnemonic from yet.";

  return runPrompt(
    [
      "Create a memorable mnemonic for this flashcard.",
      "Offer one strong mnemonic (acronym, vivid image, story, or rhyme) and briefly explain how it maps to the answer.",
      "",
      summary,
    ].join("\n"),
    config,
  );
}

export function createMockMnemonic(card: CardExplainInput): string {
  return mock("Mnemonic", [
    "- Build a vivid mental image linking the question to the answer.",
    "- The stranger the image, the stickier the memory.",
    `- Card: ${formatCardForExplain(card).split("\n")[0] || "_(empty card)_"}`,
  ]);
}

export async function critiqueCard(card: CardExplainInput, config: LlmConfig): Promise<string> {
  const summary = formatCardForExplain(card);
  if (!summary.trim()) return "This card has no content to critique yet.";

  return runPrompt(
    [
      "Critique this flashcard against spaced-repetition best practices:",
      "atomicity (one fact per card), clear unambiguous prompt, minimal wording, answer brevity, and cue strength.",
      "Give 2-4 specific, actionable suggestions. If the card is already strong, say so.",
      "",
      summary,
    ].join("\n"),
    config,
  );
}

export function createMockCritique(card: CardExplainInput): string {
  return mock("Card critique", [
    "- Check the card tests exactly one fact.",
    "- Tighten the prompt so only one answer fits.",
    `- Card: ${formatCardForExplain(card).split("\n")[0] || "_(empty card)_"}`,
  ]);
}

/* ----------------------------------------------------------------------
 * Deck-level actions
 * -------------------------------------------------------------------- */

export interface DeckSummaryInput {
  deckName: string;
  cardCount: number;
  sampleCards: string[];
  tags?: string[];
}

export async function summarizeDeck(input: DeckSummaryInput, config: LlmConfig): Promise<string> {
  return runPrompt(
    [
      `Summarize what the deck "${input.deckName}" covers (${input.cardCount} cards).`,
      "Group the content into 3-6 named topic clusters with one line each.",
      input.tags?.length ? `Tags in use: ${input.tags.join(", ")}` : "",
      "",
      "Sample card prompts:",
      ...input.sampleCards.map((c) => `- ${c}`),
    ]
      .filter(Boolean)
      .join("\n"),
    config,
  );
}

export function createMockDeckSummary(input: DeckSummaryInput): string {
  return mock(`Topics in "${input.deckName}"`, [
    `- ${input.cardCount} cards across ${input.tags?.length ?? 0} tags.`,
    "- Sample prompts:",
    ...input.sampleCards.slice(0, 5).map((c) => `  - ${c}`),
  ]);
}

export interface WeakSpotCard {
  prompt: string;
  lapses: number;
  reps: number;
  stability: number | null;
}

export interface WeakSpotsInput {
  deckName: string;
  weakCards: WeakSpotCard[];
}

export async function deckWeakSpots(input: WeakSpotsInput, config: LlmConfig): Promise<string> {
  if (!input.weakCards.length) {
    return `No weak spots found in **${input.deckName}** — no cards with repeated lapses yet. Keep reviewing!`;
  }

  return runPrompt(
    [
      `These are the cards I struggle with most in my deck "${input.deckName}"`,
      "(sorted by lapses — times I forgot after learning).",
      "Identify common themes in what I keep forgetting and give targeted advice for fixing them.",
      "",
      ...input.weakCards.map(
        (c) => `- "${c.prompt}" — ${c.lapses} lapses over ${c.reps} reviews`,
      ),
    ].join("\n"),
    config,
  );
}

export function createMockWeakSpots(input: WeakSpotsInput): string {
  if (!input.weakCards.length) {
    return `No weak spots found in **${input.deckName}** — no cards with repeated lapses yet. Keep reviewing!`;
  }
  return mock(`Weak spots in "${input.deckName}"`, [
    "Cards you lapse on most:",
    ...input.weakCards.slice(0, 5).map((c) => `- ${c.prompt} (${c.lapses} lapses)`),
    "",
    "**Tip:** rewrite frequently-missed cards to be more atomic, or add a mnemonic.",
  ]);
}

export interface StudyPlanDeck {
  name: string;
  due: number;
  newCards: number;
  total: number;
}

export interface StudyPlanInput {
  decks: StudyPlanDeck[];
  scope: "deck" | "all";
}

export async function studyPlan(input: StudyPlanInput, config: LlmConfig): Promise<string> {
  return runPrompt(
    [
      input.scope === "deck"
        ? "Suggest a focused study plan for this deck today."
        : "Suggest what I should study today across my decks, in priority order.",
      "Be concrete: which deck(s) first, roughly how many cards per session, and when to take breaks.",
      "Base it only on these numbers:",
      "",
      ...input.decks.map(
        (d) => `- ${d.name}: ${d.due} due, ${d.newCards} new available, ${d.total} total cards`,
      ),
    ].join("\n"),
    config,
  );
}

export function createMockStudyPlan(input: StudyPlanInput): string {
  const sorted = [...input.decks].sort((a, b) => b.due - a.due);
  return mock("Study plan", [
    "Priority order by due cards:",
    ...sorted.slice(0, 5).map((d, i) => `${i + 1}. **${d.name}** — ${d.due} due, ${d.newCards} new`),
    "",
    "**Tip:** clear due reviews before introducing new cards.",
  ]);
}

/* ----------------------------------------------------------------------
 * Stats / collection actions
 * -------------------------------------------------------------------- */

export interface StatsInsightsInput {
  totalCards: number;
  stateBreakdown: { newCards: number; learning: number; review: number };
  decks: StudyPlanDeck[];
}

export async function statsInsights(input: StatsInsightsInput, config: LlmConfig): Promise<string> {
  return runPrompt(
    [
      "Analyze my flashcard stats and give 3-5 insights plus one piece of advice.",
      "",
      `Total cards: ${input.totalCards}`,
      `New (never studied): ${input.stateBreakdown.newCards}`,
      `Learning: ${input.stateBreakdown.learning}`,
      `In review: ${input.stateBreakdown.review}`,
      "",
      "Per deck:",
      ...input.decks.map(
        (d) => `- ${d.name}: ${d.due} due, ${d.newCards} new available, ${d.total} total`,
      ),
    ].join("\n"),
    config,
  );
}

export function createMockStatsInsights(input: StatsInsightsInput): string {
  return mock("Stats insights", [
    `- You have **${input.totalCards} cards** total across ${input.decks.length} decks.`,
    `- ${input.stateBreakdown.newCards} cards are still unseen.`,
    `- ${input.stateBreakdown.review} cards are in long-term review.`,
    "",
    "**Advice:** keep daily reviews small and consistent rather than bingeing.",
  ]);
}

export interface CollectionOverviewInput {
  decks: StudyPlanDeck[];
  typeCounts: Record<string, number>;
  topTags: Array<{ tag: string; count: number }>;
}

export async function collectionOverview(
  input: CollectionOverviewInput,
  config: LlmConfig,
): Promise<string> {
  return runPrompt(
    [
      "Give me an overview of my flashcard collection with observations and one suggestion.",
      "",
      "Decks:",
      ...input.decks.map((d) => `- ${d.name}: ${d.total} cards`),
      "",
      `Card types: ${Object.entries(input.typeCounts)
        .map(([t, n]) => `${t} ×${n}`)
        .join(", ") || "unknown"}`,
      `Top tags: ${input.topTags.map((t) => `${t.tag} (${t.count})`).join(", ") || "none"}`,
    ].join("\n"),
    config,
  );
}

export function createMockCollectionOverview(input: CollectionOverviewInput): string {
  return mock("Collection overview", [
    `- ${input.decks.length} decks, ${input.decks.reduce((sum, d) => sum + d.total, 0)} cards.`,
    `- Top tags: ${input.topTags.slice(0, 5).map((t) => t.tag).join(", ") || "none yet"}.`,
    "",
    "**Suggestion:** tag untagged cards so you can filter weak areas later.",
  ]);
}

/* ----------------------------------------------------------------------
 * Create / community actions
 * -------------------------------------------------------------------- */

export async function suggestFocusPrompt(sourceExcerpt: string, config: LlmConfig): Promise<string> {
  if (!sourceExcerpt.trim()) {
    return "Add some source material first, then I can suggest a focus prompt.";
  }

  return runPrompt(
    [
      "Based on this source material, suggest 2-3 focus prompts I could use to guide flashcard generation",
      '(e.g. "Focus on definitions and key dates"). One line each, most useful first.',
      "",
      "Source excerpt:",
      sourceExcerpt.slice(0, 4000),
    ].join("\n"),
    config,
  );
}

export function createMockFocusPrompt(sourceExcerpt: string): string {
  if (!sourceExcerpt.trim()) {
    return "Add some source material first, then I can suggest a focus prompt.";
  }
  return mock("Focus prompt ideas", [
    '- "Focus on key definitions and terminology."',
    '- "Emphasize cause-and-effect relationships."',
    '- "Prioritize names, dates, and numbers."',
  ]);
}

export interface RecommendDecksInput {
  myDeckNames: string[];
  communityDecks: Array<{ title: string; description: string | null; cardCount: number }>;
}

export async function recommendDecks(input: RecommendDecksInput, config: LlmConfig): Promise<string> {
  if (!input.communityDecks.length) {
    return "There are no community decks available to recommend right now.";
  }

  return runPrompt(
    [
      "Recommend up to 3 community decks for me based on my existing collection.",
      "Explain in one line each why it fits. Only choose from the available list.",
      "",
      `My decks: ${input.myDeckNames.join(", ") || "(none yet)"}`,
      "",
      "Available community decks:",
      ...input.communityDecks.map(
        (d) => `- ${d.title} (${d.cardCount} cards)${d.description ? ` — ${d.description}` : ""}`,
      ),
    ].join("\n"),
    config,
  );
}

export function createMockRecommendDecks(input: RecommendDecksInput): string {
  if (!input.communityDecks.length) {
    return "There are no community decks available to recommend right now.";
  }
  return mock("Deck recommendations", [
    ...input.communityDecks.slice(0, 3).map(
      (d) => `- **${d.title}** (${d.cardCount} cards)${d.description ? ` — ${d.description}` : ""}`,
    ),
  ]);
}
