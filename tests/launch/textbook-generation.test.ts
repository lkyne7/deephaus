import { beforeEach, describe, expect, it, vi } from "vitest";
const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("../../packages/llm/node_modules/openai/index.mjs", () => ({ default: class { chat = { completions: { create } }; } }));
import { generateCardsFromChunks } from "../../packages/llm/src/generate";
import { MAX_CARDS_PER_JOB, parseGenerationSettings } from "../../packages/shared/src/index";

describe("textbook generation coverage", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockImplementation(async (request) => {
      const index = Number(/Chapter(\d+)/.exec(request.messages[1].content)?.[1]);
      return { choices: [{ message: { content: JSON.stringify({ cards: Array.from({ length: 8 }, (_, card) => ({
        type: "basic", front: `What is concept ${index}-${card}?`, back: `Answer ${index}-${card}`,
        clozeText: null, extra: null, sourceQuote: "A source sentence.", tags: [],
      })) }) } }], usage: { total_tokens: 10 } };
    });
  });
  const chunks = (count: number) => Array.from({ length: count }, (_, index) => ({
    index, sourceRef: `Chapter${index}`, text: "A source sentence. ".repeat(250),
  }));
  it("keeps early and late chapters when the model exceeds the job cap", async () => {
    const progress = vi.fn();
    const result = await generateCardsFromChunks(chunks(150), parseGenerationSettings({}), { apiKey: "test" }, progress);
    expect(create).toHaveBeenCalledTimes(150);
    expect(result.cards).toHaveLength(MAX_CARDS_PER_JOB);
    expect(new Set(result.cards.map(card => card.chunkIndex)).size).toBe(150);
    expect(result.cards.some(card => card.chunkIndex === 149)).toBe(true);
    expect(progress).toHaveBeenLastCalledWith(150, 150);
    expect(result.tokenUsage).toBe(1500);
  });
  it("spreads coverage through the final chapter even with more chunks than card slots", async () => {
    const result = await generateCardsFromChunks(chunks(1001), parseGenerationSettings({}), { apiKey: "test" });
    expect(create).toHaveBeenCalledTimes(1001);
    expect(result.cards).toHaveLength(MAX_CARDS_PER_JOB);
    expect(result.cards.some(card => card.chunkIndex === 0)).toBe(true);
    expect(result.cards.some(card => card.chunkIndex === 1000)).toBe(true);
  });
  it("keeps all cards and source order for a small document", async () => {
    const result = await generateCardsFromChunks(chunks(2), parseGenerationSettings({}), { apiKey: "test" });
    expect(result.cards).toHaveLength(16);
    expect(result.cards.map(card => card.chunkIndex)).toEqual([...Array(8).fill(0), ...Array(8).fill(1)]);
  });
  it("bounds requests to four and preserves order when chunks finish out of order", async () => {
    const response = create.getMockImplementation()!;
    let active = 0, peak = 0;
    create.mockImplementation(async (request) => {
      active += 1;
      peak = Math.max(peak, active);
      const index = Number(/Chapter(\d+)/.exec(request.messages[1].content)?.[1]);
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 20 : 1));
      const result = await response(request);
      active -= 1;
      return result;
    });
    const progress = vi.fn();
    const result = await generateCardsFromChunks(chunks(12), parseGenerationSettings({}), { apiKey: "test" }, progress);
    expect(peak).toBe(4);
    expect(result.cards.map(card => card.chunkIndex)).toEqual(Array.from({ length: 12 }, (_, index) => Array(8).fill(index)).flat());
    expect(progress.mock.calls.map(call => call[0])).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
  });
});
