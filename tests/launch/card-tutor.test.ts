import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { openaiCreate, anthropicStream } = vi.hoisted(() => ({ openaiCreate: vi.fn(), anthropicStream: vi.fn() }));
vi.mock("../../packages/llm/node_modules/openai/index.mjs", () => ({ default: class { chat = { completions: { create: openaiCreate } }; } }));
vi.mock("../../packages/llm/node_modules/@anthropic-ai/sdk/index.mjs", () => ({ default: class { beta = { messages: { stream: anthropicStream } }; } }));
import {
  TUTOR_MODEL,
  answerFollowUp,
  answerTexts,
  explainCard,
  hintLeaksAnswer,
  hintsForCard,
  resolveTutorModel,
} from "../../packages/llm/src/card-tutor";
import { toAnthropicSchema } from "../../packages/llm/src/generation-models";
import { cardContentHash, rankSimilarCards } from "../../packages/shared/src/index";
import { APP_SCHEMA } from "../../packages/local-db/src/schema";
import { getLocalCardExplanation } from "../../packages/local-db/src/queries/card-explanation";

const card = { type: "basic" as const, front: "Damage to which area impairs speech production?", back: "Broca's area" };

function claudeReturns(value: unknown) {
  anthropicStream.mockReturnValue({
    finalMessage: async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(value) }],
      usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }),
  });
}

describe("card tutor", () => {
  beforeEach(() => {
    openaiCreate.mockReset();
    anthropicStream.mockReset();
  });

  it("runs on Haiku 5.5 at low effort and falls back to OpenAI without an Anthropic key", () => {
    expect(resolveTutorModel({ anthropicApiKey: "a", openaiApiKey: "o" }, {})).toEqual(TUTOR_MODEL);
    expect(TUTOR_MODEL).toEqual({ provider: "anthropic", model: "claude-haiku-5-5", effort: "low" });
    expect(resolveTutorModel({ openaiApiKey: "o" }, {}).provider).toBe("openai");
    expect(resolveTutorModel({ anthropicApiKey: "a" }, { TUTOR_MODEL: "anthropic:claude-sonnet-5-5@medium" }).model).toBe(
      "claude-sonnet-5-5",
    );
  });

  it("asks Claude for structured output and keeps only a confusable card from the deck", async () => {
    claudeReturns({
      gist: "It turns meaning into speech.",
      why: ["Left frontal lobe.", " ", "Comprehension is elsewhere."],
      confusable: { card_id: "made-up", note: "Not in the deck." },
      hook: "",
      card_issue: { problem: "Vague", fix: { front: null, back: "Broca's area", cloze_text: null, extra: null } },
    });
    const { explanation, model } = await explainCard(card, { anthropicApiKey: "a" }, {
      candidates: [{ id: "wernicke", type: "basic", front: "Fluent but meaningless speech?", back: "Wernicke's area" }],
      env: {},
    });
    const request = anthropicStream.mock.calls[0]![0];
    expect(request.model).toBe("claude-haiku-5-5");
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.messages[0].content).toContain("wernicke:");
    expect(model).toBe("anthropic:claude-haiku-5-5@low");
    expect(explanation.why).toEqual(["Left frontal lobe.", "Comprehension is elsewhere."]);
    expect(explanation.confusable).toBeNull();
    expect(explanation.hook).toBeNull();
    // A "fix" that changes nothing is dropped.
    expect(explanation.card_issue).toBeNull();
  });

  // Claude answers 400 to a schema that keeps `properties`, `required`, `items`
  // or `additionalProperties` beside an `anyOf`, which fails the whole request.
  function keywordsBesideAnyOf(schema: unknown, path = "$"): string[] {
    if (Array.isArray(schema)) return schema.flatMap((item, i) => keywordsBesideAnyOf(item, `${path}[${i}]`));
    if (!schema || typeof schema !== "object") return [];
    const node = schema as Record<string, unknown>;
    const own = "anyOf" in node ? Object.keys(node).filter((key) => key !== "anyOf").map((key) => `${path}.${key}`) : [];
    return [...own, ...Object.entries(node).flatMap(([key, value]) => keywordsBesideAnyOf(value, `${path}.${key}`))];
  }

  it("moves what describes a nullable value into its own branch for Claude", () => {
    expect(toAnthropicSchema({ type: ["string", "null"] })).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] });
    expect(
      toAnthropicSchema({
        type: ["object", "null"],
        additionalProperties: false,
        required: ["tags"],
        properties: { tags: { type: ["array", "null"], items: { type: "string" } } },
      }),
    ).toEqual({
      anyOf: [
        {
          type: "object",
          additionalProperties: false,
          required: ["tags"],
          properties: { tags: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] } },
        },
        { type: "null" },
      ],
    });
  });

  it("sends Claude schemas it accepts for an explanation and for a follow-up", async () => {
    claudeReturns({ gist: "It turns meaning into speech.", why: [], confusable: null, hook: null, card_issue: null });
    const { explanation } = await explainCard(card, { anthropicApiKey: "a" }, { env: {} });
    claudeReturns({ text: "The card is right.", fix: null, new_card: null });
    await answerFollowUp(card, explanation, [], "Is this card right?", { anthropicApiKey: "a" }, { env: {} });

    expect(anthropicStream).toHaveBeenCalledTimes(2);
    for (const [request] of anthropicStream.mock.calls) {
      const schema = request.output_config.format.schema;
      expect(keywordsBesideAnyOf(schema)).toEqual([]);
      expect(JSON.stringify(schema)).not.toContain('"type":["');
    }
    const explain = anthropicStream.mock.calls[0]![0].output_config.format.schema;
    expect(explain.properties.card_issue.anyOf[0]).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["problem", "fix"],
    });
    expect(explain.properties.card_issue.anyOf[1]).toEqual({ type: "null" });
    const followUp = anthropicStream.mock.calls[1]![0].output_config.format.schema;
    expect(followUp.properties.new_card.anyOf[0]).toMatchObject({ type: "object", required: ["front", "back"] });
  });

  it("drops hints that give the answer away", async () => {
    claudeReturns({ hints: ["It's Broca's area.", "Look at the left frontal lobe.", "Named after a French doctor."] });
    const { hints } = await hintsForCard(card, { anthropicApiKey: "a" }, { env: {} });
    expect(hints).toEqual(["Look at the left frontal lobe.", "Named after a French doctor."]);
  });

  it("checks only the active cloze answer", () => {
    const cloze = { type: "cloze" as const, cloze_text: "{{c1::Broca's area}} handles {{c2::speech production}}." };
    expect(answerTexts(cloze, 2)).toEqual(["speech production"]);
    expect(hintLeaksAnswer("Think about speech production.", answerTexts(cloze, 2))).toBe(true);
    expect(hintLeaksAnswer("Think about the frontal lobe.", answerTexts(cloze, 2))).toBe(false);
  });

  it("ranks same-deck cards by shared words", () => {
    const ranked = rankSimilarCards(
      { id: "a", ...card },
      [
        { id: "b", type: "basic", front: "Which area handles speech comprehension?", back: "Wernicke's area" },
        { id: "c", type: "basic", front: "What is the capital of France?", back: "Paris" },
        { id: "a", ...card },
      ],
      5,
    );
    expect(ranked.map((c) => c.id)).toEqual(["b"]);
  });
});

function localDb() {
  const sqlite = new DatabaseSync(":memory:");
  for (const table of APP_SCHEMA.tables)
    sqlite.exec(
      `CREATE TABLE "${table.name}" (id TEXT PRIMARY KEY,${table.columns.map((c) => `"${c.name}" ${c.type}`).join(",")})`,
    );
  const db: any = {
    async getOptional(sql: string, params: any[] = []) {
      return sqlite.prepare(sql).get(...params) ?? null;
    },
  };
  return { db, sqlite };
}

describe("offline explanation reader", () => {
  it("returns the saved explanation offline and marks it stale after an edit", async () => {
    const { db, sqlite } = localDb();
    sqlite.exec(`INSERT INTO sources (id, title) VALUES ('src', 'Psychology 2e')`);
    sqlite.exec(`INSERT INTO generation_jobs (id, source_id) VALUES ('job', 'src')`);
    sqlite
      .prepare(`INSERT INTO cards (id, job_id, type, front, back, source_quote) VALUES ('c1','job','basic',?,?,?)`)
      .run(card.front, card.back, "A quote.");
    sqlite.exec(`INSERT INTO cards (id, job_id, type, front, back) VALUES ('c2','job','basic','Fluent nonsense?','Wernicke''s area')`);
    const hash = cardContentHash({ ...card, source_quote: "A quote." });
    sqlite
      .prepare(
        `INSERT INTO card_explanations (id, card_id, content_hash, explanation, hints, thread, updated_at) VALUES ('e1','c1',?,?,?,?,?)`,
      )
      .run(
        hash,
        JSON.stringify({ gist: "Speech.", why: [], confusable: { card_id: "c2", note: "Opposite." }, hook: null, card_issue: null }),
        JSON.stringify({ "0": ["Left frontal lobe."] }),
        "[]",
        "2026-11-10 00:00:00Z",
      );

    const explained = await getLocalCardExplanation(db, "c1", { kind: "explain" });
    expect(explained?.explanation?.gist).toBe("Speech.");
    expect(explained?.source).toEqual({ id: "src", title: "Psychology 2e", quote: "A quote." });
    expect(explained?.confusable?.back).toBe("Wernicke's area");
    expect(explained?.stale).toBe(false);

    const hinted = await getLocalCardExplanation(db, "c1", { kind: "hint" });
    expect(hinted?.hints).toEqual(["Left frontal lobe."]);
    expect(hinted?.explanation).toBeNull();

    sqlite.exec(`UPDATE cards SET back = 'Broca''s area (left)' WHERE id = 'c1'`);
    expect((await getLocalCardExplanation(db, "c1", { kind: "explain" }))?.stale).toBe(true);
    expect(await getLocalCardExplanation(db, "missing", { kind: "explain" })).toBeNull();
  });
});
