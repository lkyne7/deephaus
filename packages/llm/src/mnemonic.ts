import OpenAI from "openai";
import { z } from "zod";
import type { LlmConfig } from "./generate.js";
import { MARKDOWN_LATEX_RULES } from "./prompts.js";
import type { RegeneratedCardFields } from "./regenerate-card.js";

/**
 * One-click "turn this card into a mnemonic card".
 * ---------------------------------------------------------------------
 * A mnemonic card is not a card type of its own: it is the SAME basic or
 * cloze card, rewritten so the text itself carries the memory aid, in the
 * style of the AnKing decks. For a list-type answer the canonical shape is
 *
 *   The causes of {{c2::acute respiratory distress}} syndrome may be
 *   remembered with "{{c1::SPPARTAS}}":
 *
 *   {{c1::<u>**S**</u>epsis}}
 *   {{c1::<u>**P**</u>ancreatitis}}, {{c1::<u>**P**</u>neumonia}}
 *   {{c1::<u>**A**</u>spiration}}
 *   ...
 *
 * The cue letter of every item is bold + underlined so the mapping from the
 * acronym to the items is visible at a glance. The card keeps its type, tags
 * and (for cloze) hint setting; only its content fields are rewritten. The
 * caller validates the result with `sanitizeRegeneratedCard` before saving.
 */

export type MnemonicCardType = "basic" | "cloze";

export interface MnemonicCardInput {
  card: {
    type: MnemonicCardType;
    front: string | null;
    back: string | null;
    cloze_text: string | null;
    extra: string | null;
    tags?: string[];
  };
  /** Verbatim evidence quote the card was generated from, if any. */
  sourceQuote?: string | null;
  /** Optional deck name for topical context. */
  deckName?: string | null;
  /** Whether cloze deletions should carry `::hint` segments. */
  clozeHints?: boolean;
}

export interface CardMnemonicResult {
  card: RegeneratedCardFields;
  tokenUsage: number;
}

export const DEFAULT_MNEMONIC_MODEL = "gpt-4o-mini";

const responseSchema = z.object({
  front: z.string().nullable(),
  back: z.string().nullable(),
  cloze_text: z.string().nullable(),
  extra: z.string().nullable(),
});

/** Markup for a cue letter: bold + underlined, as in the AnKing decks. */
export function cueLetter(letter: string): string {
  return `<u>**${letter}**</u>`;
}

const CLOZE_EXAMPLE = [
  'The causes of {{c2::acute respiratory distress}} syndrome may be remembered with "{{c1::SPPARTAS}}":',
  "",
  `{{c1::${cueLetter("S")}epsis}}`,
  `{{c1::${cueLetter("P")}ancreatitis}}, {{c1::${cueLetter("P")}neumonia}}`,
  `{{c1::${cueLetter("A")}spiration}}`,
  `{{c1::u${cueLetter("R")}emia}}`,
  `{{c1::${cueLetter("T")}rauma}}`,
  `{{c1::${cueLetter("A")}mniotic fluid embolism}}`,
  `{{c1::${cueLetter("S")}hock}}`,
].join("\n");

const BASIC_EXAMPLE_FRONT =
  'The causes of acute respiratory distress syndrome may be remembered with "SPPARTAS". What does each letter stand for?';
const BASIC_EXAMPLE_BACK = [
  `${cueLetter("S")}epsis`,
  `${cueLetter("P")}ancreatitis, ${cueLetter("P")}neumonia`,
  `${cueLetter("A")}spiration`,
  `u${cueLetter("R")}emia`,
  `${cueLetter("T")}rauma`,
  `${cueLetter("A")}mniotic fluid embolism`,
  `${cueLetter("S")}hock`,
].join("\n");

function systemPrompt(type: MnemonicCardType, clozeHints: boolean): string {
  const typeRules =
    type === "cloze"
      ? [
          "- This is a fill-in-the-blank (cloze) card. Return `cloze_text` and optional `extra`; `front` and `back` must be null.",
          "- Cloze structure: the mnemonic word/phrase AND every item it stands for are `{{c1::...}}`. The topic/subject term the list belongs to is `{{c2::...}}` (omit c2 if there is no natural subject term). Do not use c3 or higher.",
          "- Put the intro sentence on the first line, a blank line, then one item per line. Items sharing a cue letter go on the same line separated by a comma, as in the example.",
          clozeHints
            ? "- Add a short 1-3 word hint to the c2 deletion only ({{c2::term::hint}}); the c1 items must NOT have hints, so the cue letters stay hidden."
            : "- Do not add hints; use plain {{cN::answer}} syntax.",
          "- `extra` may hold one short clarifying sentence shown on reveal, or the original card's extra if still relevant. Otherwise null.",
          "Example cloze_text:",
          CLOZE_EXAMPLE,
        ]
      : [
          "- This is a basic question/answer card. Return `front` and `back`; `cloze_text` and `extra` must be null.",
          "- `front`: one sentence naming the topic and the mnemonic word in quotes, then ask what each letter/cue stands for (or, for a single-fact rhyme, ask for the fact).",
          "- `back`: one item per line with the cue letter marked up; items sharing a cue letter go on the same line separated by a comma. Do not repeat the question.",
          "Example front:",
          BASIC_EXAMPLE_FRONT,
          "Example back:",
          BASIC_EXAMPLE_BACK,
        ];

  return [
    "You are an expert Anki flashcard author who writes mnemonic cards in the style of the AnKing medical decks.",
    "You will receive an existing flashcard (and sometimes the source passage it came from). Rewrite it as a MNEMONIC CARD of the same type: the card text itself must carry the memory aid, exactly like the example.",
    "Rules:",
    "- Never change the card type. Keep every fact of the original card; do not add facts that are in neither the card nor the source.",
    "- Prefer a well-known existing mnemonic when one applies to this exact list (e.g. SPPARTAS, MUDPILES, SIG E CAPS). Otherwise, when the answer is a list of THREE or more parallel items, build an acronym or acrostic from the items' first letters, reordering items if that spells something memorable.",
    "- When the answer is a single fact or only two items, do NOT invent an acronym. Use a short rhyme, alliteration or wordplay that links the cue to the fact (e.g. \"C3, 4, 5 keeps the diaphragm alive\"), written in quotes after \"may be remembered with\", and mark the shared cue letters/sounds in both the mnemonic and the fact.",
    "- The mnemonic must map EXACTLY: read in order, the letters of an acronym (or the first letters of the words of an acrostic phrase) are precisely the marked cue letters, one per item — no extra, missing or reordered letters. Check this before answering; if the first letters do not spell anything, use an acrostic phrase whose words start with those letters instead of inventing a word.",
    `- Mark the cue letter of EVERY item with ${cueLetter("X")} (bold + underline). The cue letter is normally the first letter; when it is not (e.g. u${cueLetter("R")}emia for R) leave the preceding letters unmarked.`,
    '- The mnemonic word itself is written in double quotes and is NOT letter-marked. Use the phrase "may be remembered with".',
    "- If the card already is a mnemonic card, write a clearly different mnemonic for the same items.",
    "- Do not add headings, labels such as \"Mnemonic:\", or closing remarks.",
    ...typeRules,
    MARKDOWN_LATEX_RULES,
    "Respond with JSON only.",
  ].join("\n");
}

function truncate(text: string, max: number): string {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

function buildUserPrompt(input: MnemonicCardInput): string {
  const lines: string[] = [];
  if (input.deckName?.trim()) lines.push(`Deck: ${input.deckName.trim()}`);
  lines.push("Current card:");
  lines.push(
    JSON.stringify(
      {
        type: input.card.type,
        front: input.card.front,
        back: input.card.back,
        cloze_text: input.card.cloze_text,
        extra: input.card.extra,
        tags: input.card.tags ?? [],
      },
      null,
      0,
    ),
  );
  if (input.sourceQuote?.trim()) {
    lines.push("", "Evidence quote the card was generated from:", truncate(input.sourceQuote, 1_500));
  }
  return lines.join("\n");
}

/** Ask the model to rewrite `input.card` as a mnemonic card of the same type. */
export async function generateCardMnemonic(
  input: MnemonicCardInput,
  config: LlmConfig,
): Promise<CardMnemonicResult> {
  const client = new OpenAI({ apiKey: config.apiKey });
  const model = config.model ?? DEFAULT_MNEMONIC_MODEL;

  const response = await client.chat.completions.create({
    model,
    temperature: 0.8,
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "mnemonic_flashcard",
        strict: true,
        schema: {
          type: "object",
          properties: {
            front: { type: ["string", "null"] },
            back: { type: ["string", "null"] },
            cloze_text: { type: ["string", "null"] },
            extra: { type: ["string", "null"] },
          },
          required: ["front", "back", "cloze_text", "extra"],
          additionalProperties: false,
        },
      },
    },
    messages: [
      { role: "system", content: systemPrompt(input.card.type, input.clozeHints ?? false) },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const tokenUsage = response.usage?.total_tokens ?? 0;
  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("The model returned an empty card.");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(content);
  } catch {
    throw new Error("The model returned invalid JSON.");
  }
  const parsed = responseSchema.safeParse(parsedJson);
  if (!parsed.success) throw new Error("The model response did not match the expected card schema.");
  return { card: parsed.data, tokenUsage };
}

/** Plain-text answer items of a card, used by the offline mock. */
function answerItems(card: MnemonicCardInput["card"]): string[] {
  let text: string;
  if (card.type === "cloze") {
    const hidden = [...(card.cloze_text ?? "").matchAll(/\{\{c\d+::([^}:]+)(?:::[^}]*)?\}\}/g)].map(
      (m) => m[1]!.trim(),
    );
    text = hidden.join(", ");
  } else {
    text = card.back ?? card.extra ?? "";
  }
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/[*_`#>$\\]/g, "")
    .split(/[\n,;/]+|\band\b/)
    .map((w) => w.trim())
    .filter((w) => /^[\p{L}\p{N}]/u.test(w))
    .slice(0, 8);
}

/** Topic text (question / non-cloze body) used by the offline mock. */
function topicText(card: MnemonicCardInput["card"]): string {
  const raw =
    card.type === "cloze"
      ? (card.cloze_text ?? "").replace(/\{\{c\d+::([^}:]+)(?:::[^}]*)?\}\}/g, "$1")
      : (card.front ?? "");
  return raw.replace(/<[^>]+>/g, "").replace(/[*_`#>$\\]/g, "").replace(/\s+/g, " ").trim().replace(/[?.!:]+$/, "");
}

/**
 * Offline stand-in used when no OpenAI key is configured: builds a first-letter
 * acronym from the answer items in the AnKing layout so the UI flow
 * (pulse → replace → undo) can be exercised without a model.
 */
export function createMockCardMnemonic(input: MnemonicCardInput): CardMnemonicResult {
  const { card } = input;
  const items = answerItems(card);
  const safeItems = items.length > 0 ? items : ["Placeholder"];
  const acronym = safeItems.map((w) => w[0]!.toUpperCase()).join("");
  const marked = safeItems.map((w) => `${cueLetter(w[0]!.toUpperCase())}${w.slice(1)}`);
  const topic = topicText(card) || "This";

  if (card.type === "cloze") {
    const intro = `${topic} may be remembered with "{{c1::${acronym}}}":`;
    const list = marked.map((item) => `{{c1::${item}}}`).join("\n");
    return {
      card: { front: null, back: null, cloze_text: `${intro}\n\n${list}`, extra: card.extra },
      tokenUsage: 0,
    };
  }
  return {
    card: {
      front: `${topic} may be remembered with "${acronym}". What does each letter stand for?`,
      back: marked.join("\n"),
      cloze_text: null,
      extra: null,
    },
    tokenUsage: 0,
  };
}
