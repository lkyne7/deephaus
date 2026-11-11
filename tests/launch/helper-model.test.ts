import { beforeEach, describe, expect, it, vi } from "vitest";
const { openaiCreate, anthropicStream } = vi.hoisted(() => ({ openaiCreate: vi.fn(), anthropicStream: vi.fn() }));
vi.mock("../../packages/llm/node_modules/openai/index.mjs", () => ({ default: class { chat = { completions: { create: openaiCreate } }; } }));
vi.mock("../../packages/llm/node_modules/@anthropic-ai/sdk/index.mjs", () => ({ default: class { beta = { messages: { stream: anthropicStream } }; } }));
import { resolveHelperModel } from "../../packages/llm/src/helper-model";
import { generateCardMnemonic } from "../../packages/llm/src/mnemonic";
import { editCardsWithInstruction } from "../../packages/llm/src/edit-cards";
import { hintForCard } from "../../packages/llm/src/assistant";

const RETIRED = /gpt-4o/;
const card = { type: "basic" as const, front: "Damage to which area impairs speech production?", back: "Broca's area" };

function claudeReturns(value: unknown) {
  anthropicStream.mockReturnValue({
    finalMessage: async () => ({
      stop_reason: "end_turn",
      content: [{ type: "text", text: JSON.stringify(value) }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
  });
}

beforeEach(() => {
  openaiCreate.mockReset();
  anthropicStream.mockReset();
});

describe("card helper model", () => {
  it("uses Haiku with an Anthropic key and a current OpenAI model without one", () => {
    expect(resolveHelperModel({ apiKey: "o", anthropicApiKey: "a" }, {})).toEqual({
      provider: "anthropic",
      model: "claude-haiku-5-5",
      effort: "low",
    });
    const standIn = resolveHelperModel({ apiKey: "o" }, {});
    expect(standIn.provider).toBe("openai");
    expect(standIn.model).not.toMatch(RETIRED);
    expect(resolveHelperModel({ apiKey: "o", model: "gpt-custom" }, {})).toEqual({ provider: "openai", model: "gpt-custom" });
  });

  it("sends mnemonic rewrites to Claude when an Anthropic key is set", async () => {
    claudeReturns({ front: "Speech production?", back: "<b>B</b>roca = <b>B</b>uilds speech", cloze_text: null, extra: null });
    const result = await generateCardMnemonic({ card: { ...card, cloze_text: null, extra: null } }, { apiKey: "o", anthropicApiKey: "a" });
    expect(result.card.back).toBe("<b>B</b>roca = <b>B</b>uilds speech");
    expect(anthropicStream).toHaveBeenCalledWith(expect.objectContaining({ model: "claude-haiku-5-5" }));
    expect(openaiCreate).not.toHaveBeenCalled();
  });

  it("sends assistant edits to a reasoning OpenAI model without a temperature when there is no Anthropic key", async () => {
    openaiCreate.mockResolvedValue({
      choices: [{ message: { content: JSON.stringify({ summary: "Tightened", cards: [] }) } }],
      usage: { total_tokens: 7 },
    });
    const result = await editCardsWithInstruction(
      { cards: [{ id: "c1", ...card, cloze_text: null, extra: null, tags: [] }], instruction: "Shorter" },
      { apiKey: "o" },
    );
    expect(result.summary).toBe("Tightened");
    const request = openaiCreate.mock.calls[0]![0];
    expect(request.model).not.toMatch(RETIRED);
    expect(request.temperature).toBeUndefined();
    expect(request.reasoning_effort).toBeDefined();
  });

  it("returns the assistant's markdown answer", async () => {
    claudeReturns({ markdown: "- Think of **B**roca as **B**uilding words." });
    expect(await hintForCard(card, { apiKey: "o", anthropicApiKey: "a" })).toBe("- Think of **B**roca as **B**uilding words.");
  });

  it("throws provider errors instead of returning an empty card", async () => {
    anthropicStream.mockImplementation(() => {
      throw new Error("overloaded");
    });
    await expect(generateCardMnemonic({ card: { ...card, cloze_text: null, extra: null } }, { apiKey: "o", anthropicApiKey: "a" })).rejects.toThrow("overloaded");
  });
});
