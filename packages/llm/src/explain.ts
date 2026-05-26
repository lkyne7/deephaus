import OpenAI from "openai";
import type { LlmConfig } from "./generate.js";

export interface CardExplainInput {
  type: "basic" | "cloze";
  front?: string | null;
  back?: string | null;
  cloze_text?: string | null;
  extra?: string | null;
}

function stripClozeSyntax(text: string): string {
  return text.replace(/\{\{c(\d+)::([\s\S]+?)(?:::([\s\S]+?))?\}\}/g, (_m, _id, answer, hint) => {
    if (hint) return `[${answer} (hint: ${hint})]`;
    return `[${answer}]`;
  });
}

function cleanField(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return stripClozeSyntax(value).replace(/\s+/g, " ").trim();
}

export function formatCardForExplain(card: CardExplainInput): string {
  if (card.type === "cloze") {
    const parts = [
      cleanField(card.cloze_text) && `Cloze: ${cleanField(card.cloze_text)}`,
      cleanField(card.extra) && `Notes: ${cleanField(card.extra)}`,
    ].filter(Boolean);
    return parts.join("\n");
  }

  const parts = [
    cleanField(card.front) && `Front: ${cleanField(card.front)}`,
    cleanField(card.back) && `Back: ${cleanField(card.back)}`,
    cleanField(card.extra) && `Extra: ${cleanField(card.extra)}`,
  ].filter(Boolean);
  return parts.join("\n");
}

export function createMockExplanation(card: CardExplainInput): string {
  const summary = formatCardForExplain(card);
  return [
    "### Quick explanation",
    "",
    "This is a placeholder explanation (no OpenAI API key configured).",
    "",
    "**Card content**",
    summary || "_(empty card)_",
    "",
    "**Study tip**",
    "Try connecting this fact to something you already know, then say it out loud without looking at the answer.",
  ].join("\n");
}

export async function explainCard(card: CardExplainInput, config: LlmConfig): Promise<string> {
  const cardSummary = formatCardForExplain(card);
  if (!cardSummary.trim()) {
    return "This card has no content to explain yet.";
  }

  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? "gpt-4o-mini";

  const response = await client.chat.completions.create({
    model,
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content: [
          "You are a concise, accurate tutor helping a student understand a flashcard during review.",
          "Explain the underlying concept in plain language.",
          "Use short markdown sections and bullet points when helpful.",
          "Do not invent facts unrelated to the card.",
          "Keep the response under 250 words unless the card is complex.",
        ].join(" "),
      },
      {
        role: "user",
        content: `Explain this flashcard so I understand it more deeply:\n\n${cardSummary}`,
      },
    ],
  });

  return response.choices[0]?.message?.content?.trim() || "No explanation was generated.";
}
