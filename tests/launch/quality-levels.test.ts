import { beforeEach, describe, expect, it, vi } from "vitest";
const { openaiCreate, anthropicStream } = vi.hoisted(() => ({ openaiCreate: vi.fn(), anthropicStream: vi.fn() }));
vi.mock("../../packages/llm/node_modules/openai/index.mjs", () => ({ default: class { chat = { completions: { create: openaiCreate } }; } }));
vi.mock("../../packages/llm/node_modules/@anthropic-ai/sdk/index.mjs", () => ({ default: class { beta = { messages: { stream: anthropicStream } }; } }));
import { generateCardsFromChunks } from "../../packages/llm/src/generate";
import { GENERATION_MODELS, resolveGenerationModel } from "../../packages/llm/src/generation-models";
import { creditsForCards, parseGenerationSettings, qualityLevelCreditsLabel } from "../../packages/shared/src/index";

const card = { type: "basic", front: "What does the amygdala process?", back: "Fear", clozeText: null, extra: null, sourceQuote: null, tags: [] };
const chunk = { index: 0, sourceRef: "Notes::Chunk1", text: "The amygdala processes fear. ".repeat(40) };

describe("quality levels", () => {
  beforeEach(() => {
    openaiCreate.mockReset();
    anthropicStream.mockReset();
    openaiCreate.mockResolvedValue({ choices: [{ message: { content: JSON.stringify({ cards: [card] }) } }], usage: { total_tokens: 10 } });
    anthropicStream.mockReturnValue({
      finalMessage: async () => ({
        stop_reason: "end_turn",
        content: [{ type: "text", text: JSON.stringify({ cards: [card] }) }],
        usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      }),
    });
  });

  it("defaults existing decks to medium and charges whole credits", () => {
    expect(parseGenerationSettings({}).qualityLevel).toBe("medium");
    expect(creditsForCards(7, "low")).toBe(4);
    expect(creditsForCards(7, "medium")).toBe(7);
    expect(creditsForCards(7, "high")).toBe(7 * 10);
    expect(creditsForCards(0, "high")).toBe(0);
    expect(qualityLevelCreditsLabel("low")).toBe("1 credit per 2 cards");
    expect(qualityLevelCreditsLabel("medium")).toBe("1 credit per card");
  });

  it("falls back to OpenAI for Claude levels when no Anthropic key is set", () => {
    for (const level of ["low", "medium", "high"] as const) {
      expect(resolveGenerationModel(level, { openaiApiKey: "k" }, {}).provider).toBe("openai");
      expect(resolveGenerationModel(level, { openaiApiKey: "k", anthropicApiKey: "a" }, {})).toEqual(GENERATION_MODELS[level]);
    }
  });

  it("lets the server override a level's model", () => {
    expect(resolveGenerationModel("high", { anthropicApiKey: "a" }, { GENERATION_MODEL_HIGH: "anthropic:claude-sonnet-5-5@medium" }))
      .toEqual({ provider: "anthropic", model: "claude-sonnet-5-5", effort: "medium" });
    expect(resolveGenerationModel("low", { anthropicApiKey: "a" }, { GENERATION_MODEL_LOW: "nonsense" })).toEqual(GENERATION_MODELS.low);
  });

  it("sends a Claude level to Anthropic with structured output and its effort", async () => {
    const level = (["low", "medium", "high"] as const).find((l) => GENERATION_MODELS[l].provider === "anthropic")!;
    const result = await generateCardsFromChunks(
      [chunk],
      parseGenerationSettings({ qualityLevel: level }),
      { apiKey: "openai-key", anthropicApiKey: "anthropic-key" },
    );
    expect(openaiCreate).not.toHaveBeenCalled();
    const request = anthropicStream.mock.calls[0]![0];
    expect(request.model).toBe(GENERATION_MODELS[level].model);
    expect(request.output_config.format.type).toBe("json_schema");
    expect(request.output_config.effort).toBe(GENERATION_MODELS[level].effort);
    expect(request).not.toHaveProperty("temperature");
    expect(result.cards).toHaveLength(1);
  });

  it("sends an OpenAI reasoning level without temperature", async () => {
    const level = (["low", "medium", "high"] as const).find((l) => GENERATION_MODELS[l].provider === "openai")!;
    await generateCardsFromChunks([chunk], parseGenerationSettings({ qualityLevel: level }), { apiKey: "openai-key" });
    const request = openaiCreate.mock.calls[0]![0];
    expect(request.model).toBe(GENERATION_MODELS[level].model);
    expect(request.reasoning_effort).toBe(GENERATION_MODELS[level].effort);
    expect(request).not.toHaveProperty("temperature");
  });
});
