import { generatedCardSchema } from "./schemas.js";
export type GenerationDefect = {
  index: number;
  kind:
    | "malformed"
    | "duplicate"
    | "broken_reference"
    | "unsupported_quote"
    | "missing_source";
};
/** Deterministic regression evaluation. Semantic accuracy still needs reviewed examples. */
export function evaluateGenerationQuality(
  cards: unknown[],
  source: { text: string; references: string[] },
): GenerationDefect[] {
  const defects: GenerationDefect[] = [],
    seen = new Set<string>(),
    refs = new Set(source.references);
  const normalize = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  const sourceText = normalize(source.text);
  if (!sourceText) defects.push({ index: -1, kind: "missing_source" });
  for (const [index, raw] of cards.entries()) {
    const parsed = generatedCardSchema.safeParse(raw);
    if (!parsed.success) {
      defects.push({ index, kind: "malformed" });
      continue;
    }
    const card = parsed.data;
    if (
      (card.type === "basic" && (!card.front?.trim() || !card.back?.trim())) ||
      (card.type === "cloze" &&
        !/\{\{c\d+::.+?\}\}/s.test(card.clozeText ?? ""))
    )
      defects.push({ index, kind: "malformed" });
    const key = [
      card.type,
      card.front ?? "",
      card.back ?? "",
      card.clozeText ?? "",
    ]
      .map(normalize)
      .join("|");
    if (seen.has(key)) defects.push({ index, kind: "duplicate" });
    seen.add(key);
    const ref = (raw as { sourceRef?: unknown }).sourceRef;
    if (typeof ref === "string" && !refs.has(ref))
      defects.push({ index, kind: "broken_reference" });
    if (card.sourceQuote && !sourceText.includes(normalize(card.sourceQuote)))
      defects.push({ index, kind: "unsupported_quote" });
  }
  return defects;
}
